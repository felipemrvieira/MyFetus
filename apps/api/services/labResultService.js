/**
 * Resultados laboratoriais extraídos dos exames e a revisão médica (E2-04).
 *
 * O parser (E2-03) lê o texto extraído do documento e cada analito vira uma
 * linha em lab_results com status `pending`. O médico vinculado decide linha a
 * linha: aceitar, corrigir ou rejeitar; uma decisão pode ser reaberta. Cada
 * decisão aumenta a versão e grava um snapshot em lab_result_reviews, então o
 * valor original e as versões anteriores nunca se perdem.
 *
 * Só `accepted` e `corrected` têm uso clínico (prontuário, gráficos e motor de
 * risco). Decisões do P.O. em 29/10/2026 na #61.
 */
const { ANALYTES, parseExamText } = require('./labResultParser');

const STATUSES = Object.freeze(['pending', 'accepted', 'corrected', 'rejected']);
const CLINICALLY_USABLE_STATUSES = Object.freeze(['accepted', 'corrected']);
const EXAM_TYPES = Object.freeze(['fasting', 'casual', 'ogtt75g']);
const TIMEPOINTS = Object.freeze(['0h', '1h', '2h']);
const LOW_CONFIDENCE_THRESHOLD = 0.9;
const MAX_REASON_LENGTH = 1000;
const MAX_TEXT_VALUE_LENGTH = 120;

const TRANSITIONS = Object.freeze({
  accept: { from: ['pending'], to: 'accepted', reasonRequired: false },
  correct: { from: ['pending'], to: 'corrected', reasonRequired: true },
  reject: { from: ['pending'], to: 'rejected', reasonRequired: true },
  reopen: { from: ['accepted', 'corrected', 'rejected'], to: 'pending', reasonRequired: true },
});

const VALUE_FIELDS = Object.freeze([
  'value', 'unit', 'reference_low', 'reference_high', 'observed_at', 'exam_type', 'timepoint',
]);

const ANALYTE_LABELS = Object.freeze(
  Object.fromEntries(ANALYTES.map((analyte) => [analyte.id, analyte.label]))
);

class LabResultError extends Error {
  constructor(code, message, status = 422, details = undefined) {
    super(message);
    this.name = 'LabResultError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function isGlucose(analyteId) {
  return analyteId === 'glucose';
}

function present(value) {
  return value !== null && value !== undefined && String(value).trim() !== '';
}

// O parser marca jejum como timepoint "fasting"; no banco o tempo só existe no TOTG.
function normalizeExamContext(analyteId, examType, timepoint) {
  if (!isGlucose(analyteId)) return { exam_type: null, timepoint: null };
  const type = EXAM_TYPES.includes(examType) ? examType : null;
  return {
    exam_type: type,
    timepoint: type === 'ogtt75g' && TIMEPOINTS.includes(timepoint) ? timepoint : null,
  };
}

function rowsFromParse(parsed, { documentId, pregnantId }) {
  return parsed.results.map((result, index) => {
    const value = result.value_numeric ?? result.value_text ?? null;
    const context = normalizeExamContext(result.analyte_id, result.exam_type, result.timepoint);
    const values = {
      value,
      unit: result.unit,
      reference_low: result.reference_low,
      reference_high: result.reference_high,
      observed_at: result.observed_at,
    };
    return {
      document_id: documentId,
      pregnant_id: pregnantId,
      line_index: index,
      analyte_id: result.analyte_id,
      loinc: result.loinc,
      raw_text: result.raw_text,
      original_value: values.value,
      original_unit: values.unit,
      original_reference_low: values.reference_low,
      original_reference_high: values.reference_high,
      original_observed_at: values.observed_at,
      original_exam_type: context.exam_type,
      original_timepoint: context.timepoint,
      confidence: result.confidence,
      ambiguity_reason: result.ambiguity_reason,
      parser_version: result.parser_version,
      extraction_method: result.method,
      ...values,
      ...context,
    };
  });
}

function parseOptionalNumber(value, field, errors) {
  if (!present(value)) return null;
  const parsed = Number(String(value).replace(',', '.'));
  if (!Number.isFinite(parsed)) {
    errors.push(field);
    return null;
  }
  return parsed;
}

function parseDate(value, errors) {
  if (!present(value)) return null;
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const date = match && new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (!date || date.toISOString().slice(0, 10) !== value) {
    errors.push('observed_at');
    return null;
  }
  return value;
}

// Valores enviados pelo médico ao corrigir (ou o tipo da glicemia ao aceitar).
function readPayloadValues(payload = {}, allowed) {
  const errors = [];
  const values = {};
  if (allowed.includes('value') && 'value' in payload) {
    const raw = payload.value;
    const numeric = typeof raw === 'number' ? raw : Number(String(raw ?? '').replace(',', '.'));
    if (present(raw) && Number.isFinite(numeric)) values.value = numeric;
    else if (typeof raw === 'string' && present(raw) && raw.trim().length <= MAX_TEXT_VALUE_LENGTH) values.value = raw.trim();
    else errors.push('value');
  }
  if (allowed.includes('unit') && 'unit' in payload) {
    const unit = present(payload.unit) ? String(payload.unit).trim() : null;
    if (unit && unit.length > 30) errors.push('unit');
    else values.unit = unit;
  }
  for (const field of ['reference_low', 'reference_high']) {
    if (allowed.includes(field) && field in payload) values[field] = parseOptionalNumber(payload[field], field, errors);
  }
  if (allowed.includes('observed_at') && 'observed_at' in payload) {
    values.observed_at = parseDate(payload.observed_at, errors);
  }
  if (allowed.includes('exam_type') && 'exam_type' in payload) {
    if (present(payload.exam_type) && !EXAM_TYPES.includes(payload.exam_type)) errors.push('exam_type');
    else values.exam_type = payload.exam_type || null;
  }
  if (allowed.includes('timepoint') && 'timepoint' in payload) {
    if (present(payload.timepoint) && !TIMEPOINTS.includes(payload.timepoint)) errors.push('timepoint');
    else values.timepoint = payload.timepoint || null;
  }
  if (errors.length > 0) {
    throw new LabResultError('LAB_RESULT_INVALID_FIELDS', 'Há campos com formato inválido.', 400, { fields: errors });
  }
  return values;
}

// O que falta para o valor ter uso clínico. Sem isso, o médico precisa corrigir.
function missingForClinicalUse(analyteId, values) {
  const missing = [];
  if (!present(values.value)) missing.push('value');
  if (typeof values.value === 'number' && !present(values.unit)) missing.push('unit');
  if (!present(values.observed_at)) missing.push('observed_at');
  if (isGlucose(analyteId)) {
    if (!present(values.exam_type)) missing.push('exam_type');
    else if (values.exam_type === 'ogtt75g' && !present(values.timepoint)) missing.push('timepoint');
  }
  return missing;
}

function readReason(payload = {}, required) {
  const reason = typeof payload.reason === 'string' ? payload.reason.trim() : '';
  if (required && !reason) {
    throw new LabResultError('LAB_RESULT_REASON_REQUIRED', 'Informe a justificativa.', 400);
  }
  if (reason.length > MAX_REASON_LENGTH) {
    throw new LabResultError('LAB_RESULT_INVALID_FIELDS', 'A justificativa é longa demais.', 400, { fields: ['reason'] });
  }
  return reason || null;
}

function currentValues(row) {
  return Object.fromEntries(VALUE_FIELDS.map((field) => [field, row[field] ?? null]));
}

/**
 * Decide a próxima versão a partir da linha atual (já decifrada).
 * Puro: não toca no banco, para os testes cobrirem cada regra.
 */
function planReview(row, { action, payload = {}, expectedVersion }) {
  const transition = TRANSITIONS[action];
  if (!transition) throw new LabResultError('LAB_RESULT_INVALID_ACTION', 'Ação inválida.', 400);
  if (!Number.isInteger(expectedVersion)) {
    throw new LabResultError('LAB_RESULT_VERSION_REQUIRED', 'Informe a versão do resultado.', 400);
  }
  if (expectedVersion !== row.version) {
    throw new LabResultError('LAB_RESULT_VERSION_CONFLICT', 'O resultado mudou desde que foi aberto. Recarregue a tela.', 409);
  }
  if (!transition.from.includes(row.status)) {
    throw new LabResultError('LAB_RESULT_INVALID_TRANSITION', 'Esta ação não vale para o status atual.', 409);
  }

  const reason = readReason(payload, transition.reasonRequired);
  let values = currentValues(row);
  if (action === 'correct') {
    values = { ...values, ...readPayloadValues(payload, VALUE_FIELDS) };
  } else if (action === 'accept' && isGlucose(row.analyte_id)) {
    values = { ...values, ...readPayloadValues(payload, ['exam_type', 'timepoint']) };
  }
  values = { ...values, ...normalizeExamContext(row.analyte_id, values.exam_type, values.timepoint) };

  if (action === 'accept' || action === 'correct') {
    const missing = missingForClinicalUse(row.analyte_id, values);
    if (missing.length > 0) {
      throw new LabResultError(
        'LAB_RESULT_INCOMPLETE',
        action === 'accept'
          ? 'Faltam dados para aceitar este valor. Use corrigir para completar.'
          : 'Faltam dados para o valor corrigido.',
        422,
        { missing }
      );
    }
  }

  return {
    status: transition.to,
    version: row.version + 1,
    reason,
    values,
    previousStatus: row.status,
  };
}

function isLowConfidence(row) {
  const confidence = row.confidence === null || row.confidence === undefined ? null : Number(row.confidence);
  return Boolean(row.ambiguity_reason) || confidence === null || confidence < LOW_CONFIDENCE_THRESHOLD;
}

function toPublicResult(row) {
  return {
    id: Number(row.id),
    document_id: row.document_id,
    analyte_id: row.analyte_id,
    analyte: ANALYTE_LABELS[row.analyte_id] || row.analyte_id,
    loinc: row.loinc || null,
    status: row.status,
    version: row.version,
    clinically_usable: CLINICALLY_USABLE_STATUSES.includes(row.status),
    original: {
      value: row.original_value ?? null,
      unit: row.original_unit ?? null,
      reference_low: row.original_reference_low ?? null,
      reference_high: row.original_reference_high ?? null,
      observed_at: row.original_observed_at ?? null,
      exam_type: row.original_exam_type ?? null,
      timepoint: row.original_timepoint ?? null,
    },
    current: currentValues(row),
    raw_text: row.raw_text ?? null,
    confidence: row.confidence === null || row.confidence === undefined ? null : Number(row.confidence),
    low_confidence: isLowConfidence(row),
    ambiguity_reason: row.ambiguity_reason || null,
    missing_for_acceptance: row.status === 'pending' ? missingForClinicalUse(row.analyte_id, currentValues(row)) : [],
    review_reason: row.review_reason ?? null,
    reviewed_by_user_id: row.reviewed_by_user_id ?? null,
    reviewed_at: row.reviewed_at ?? null,
  };
}

function toPublicReview(review) {
  return {
    version: review.version,
    action: review.action,
    previous_status: review.previous_status,
    new_status: review.new_status,
    values: review.snapshot ?? null,
    reason: review.reason ?? null,
    reviewed_by_user_id: review.reviewed_by_user_id ?? null,
    created_at: review.created_at,
  };
}

const INSERT_COLUMNS = Object.freeze([
  'document_id', 'pregnant_id', 'line_index', 'analyte_id', 'loinc', 'raw_text',
  'original_value', 'original_unit', 'original_reference_low', 'original_reference_high',
  'original_observed_at', 'original_exam_type', 'original_timepoint', 'confidence',
  'ambiguity_reason', 'parser_version', 'extraction_method', 'value', 'unit',
  'reference_low', 'reference_high', 'observed_at', 'exam_type', 'timepoint',
  'encryption_key_version',
]);

function createLabResultService({ crypto = require('./cryptoService'), parse = parseExamText } = {}) {
  function decryptRow(row) {
    return crypto.decryptRecord(row, 'lab_results');
  }

  /**
   * Lê os analitos do texto extraído e grava os que ainda não existem.
   * Nunca sobrescreve uma linha já gravada, para não apagar uma revisão.
   */
  async function ingestDocumentResults(db, { documentId, pregnantId, text }) {
    if (!text || !String(text).trim()) return { inserted: 0, recognized: 0 };
    const rows = rowsFromParse(parse(String(text)), { documentId, pregnantId });
    let inserted = 0;
    for (const row of rows) {
      const encrypted = crypto.encryptRecord(
        { ...row, encryption_key_version: crypto.getCurrentVersion() },
        'lab_results'
      );
      const params = INSERT_COLUMNS.map((column) => encrypted[column] ?? null);
      const placeholders = INSERT_COLUMNS.map((_, index) => `$${index + 1}`).join(', ');
      const result = await db.query(
        `INSERT INTO lab_results (${INSERT_COLUMNS.join(', ')})
         VALUES (${placeholders})
         ON CONFLICT (document_id, line_index) DO NOTHING
         RETURNING id`,
        params
      );
      inserted += result.rows.length;
    }
    return { inserted, recognized: rows.length };
  }

  async function countDocumentResults(db, documentId) {
    const result = await db.query(
      'SELECT COUNT(*)::int AS total FROM lab_results WHERE document_id = $1',
      [documentId]
    );
    return result.rows[0]?.total || 0;
  }

  async function listDocumentResults(db, documentId) {
    const result = await db.query(
      'SELECT * FROM lab_results WHERE document_id = $1 ORDER BY line_index ASC',
      [documentId]
    );
    return result.rows.map((row) => toPublicResult(decryptRow(row)));
  }

  async function findResult(db, labResultId) {
    const result = await db.query(
      'SELECT id, pregnant_id, document_id FROM lab_results WHERE id = $1',
      [labResultId]
    );
    return result.rows[0] || null;
  }

  async function listHistory(db, labResultId) {
    const result = await db.query(
      `SELECT * FROM lab_result_reviews
        WHERE lab_result_id = $1
        ORDER BY version ASC`,
      [labResultId]
    );
    return result.rows.map((review) => toPublicReview(crypto.decryptRecord(review, 'lab_result_reviews')));
  }

  /**
   * Aplica uma decisão numa transação, com a linha travada. `db` é o pool:
   * a função pega uma conexão própria para o BEGIN/COMMIT.
   */
  async function reviewResult(db, { labResultId, action, payload, expectedVersion, userId }) {
    const connection = await db.connect();
    try {
      await connection.query('BEGIN');
      const locked = await connection.query('SELECT * FROM lab_results WHERE id = $1 FOR UPDATE', [labResultId]);
      if (!locked.rows[0]) throw new LabResultError('LAB_RESULT_NOT_FOUND', 'Resultado não encontrado.', 404);
      const row = decryptRow(locked.rows[0]);
      const plan = planReview(row, { action, payload, expectedVersion });

      const keyVersion = crypto.getCurrentVersion();
      const encrypted = crypto.encryptRecord({
        ...plan.values,
        review_reason: plan.reason,
      }, 'lab_results');
      const updated = await connection.query(
        `UPDATE lab_results
            SET status = $1, version = $2, value = $3, unit = $4, reference_low = $5,
                reference_high = $6, observed_at = $7, exam_type = $8, timepoint = $9,
                review_reason = $10, reviewed_by_user_id = $11, reviewed_at = CURRENT_TIMESTAMP,
                encryption_key_version = $12
          WHERE id = $13 AND version = $14
          RETURNING *`,
        [
          plan.status, plan.version, encrypted.value, encrypted.unit, encrypted.reference_low,
          encrypted.reference_high, encrypted.observed_at, plan.values.exam_type, plan.values.timepoint,
          encrypted.review_reason, userId, keyVersion, labResultId, row.version,
        ]
      );
      if (!updated.rows[0]) {
        throw new LabResultError('LAB_RESULT_VERSION_CONFLICT', 'O resultado mudou desde que foi aberto. Recarregue a tela.', 409);
      }

      const review = crypto.encryptRecord({ snapshot: plan.values, reason: plan.reason }, 'lab_result_reviews');
      await connection.query(
        `INSERT INTO lab_result_reviews
           (lab_result_id, pregnant_id, version, action, previous_status, new_status,
            snapshot, reason, reviewed_by_user_id, encryption_key_version)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          labResultId, row.pregnant_id, plan.version, action, plan.previousStatus, plan.status,
          review.snapshot, review.reason, userId, keyVersion,
        ]
      );
      await connection.query('COMMIT');
      return {
        result: toPublicResult(decryptRow(updated.rows[0])),
        analyteId: row.analyte_id,
        previousStatus: plan.previousStatus,
      };
    } catch (error) {
      await connection.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      connection.release();
    }
  }

  return {
    countDocumentResults,
    findResult,
    ingestDocumentResults,
    listDocumentResults,
    listHistory,
    reviewResult,
  };
}

module.exports = {
  CLINICALLY_USABLE_STATUSES,
  EXAM_TYPES,
  LOW_CONFIDENCE_THRESHOLD,
  LabResultError,
  STATUSES,
  TIMEPOINTS,
  createLabResultService,
  missingForClinicalUse,
  normalizeExamContext,
  planReview,
  rowsFromParse,
  toPublicResult,
};
