const { serializeEntry } = require('./dailyEntryService');

const REPORT_VERSION = 'gestation-report-v1';
const DEFAULT_TIMEZONE = 'America/Recife';
const DAY_MS = 24 * 60 * 60 * 1000;
const REVIEWED_EXAM_STATUSES = Object.freeze(['accepted', 'corrected']);

class PregnancyReportValidationError extends Error {}
class PregnancyReportNotFoundError extends Error {}

function validateId(value, field = 'id') {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw new PregnancyReportValidationError(`${field} invalido`);
  }
  return id;
}

function formatLocalDate(date, timezone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function shiftDate(dateValue, days) {
  const date = new Date(`${dateValue}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw new PregnancyReportValidationError('data de referencia invalida');
  return new Date(date.getTime() + days * DAY_MS).toISOString().slice(0, 10);
}

function buildDateWindow(now, timezone = DEFAULT_TIMEZONE) {
  const reference = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(reference.getTime())) {
    throw new PregnancyReportValidationError('data de referencia invalida');
  }
  const to = formatLocalDate(reference, timezone);
  return { from: shiftDate(to, -29), to, timezone };
}

function section(items) {
  return {
    status: items.length > 0 ? 'available' : 'not_informed',
    items,
  };
}

function stripSensitiveColumns(row, columns) {
  return Object.fromEntries(columns.map((column) => [column, row[column] ?? null]));
}

function extractVaccines(pregnant) {
  return Object.entries(pregnant)
    .filter(([field, value]) => field.startsWith('vacina_') && value !== null && value !== undefined && value !== '')
    .map(([field, value]) => ({ field, value }));
}

async function queryOne(db, text, values) {
  const result = await db.query(text, values);
  return result.rows[0] || null;
}

async function buildPregnancyReportSnapshot(db, {
  pregnancyId: pregnancyIdValue,
  crypto,
  now = () => new Date(),
  timezone = DEFAULT_TIMEZONE,
} = {}) {
  const pregnancyId = validateId(pregnancyIdValue, 'pregnancy_id');
  if (!crypto || typeof crypto.decryptRecord !== 'function') {
    throw new Error('crypto e obrigatorio');
  }
  const generatedAt = now();
  const window = buildDateWindow(generatedAt, timezone);

  const pregnancyRow = await queryOne(
    db,
    'SELECT * FROM pregnancies WHERE id = $1',
    [pregnancyId]
  );
  if (!pregnancyRow) throw new PregnancyReportNotFoundError('Gestacao nao encontrada');

  const pregnantRow = await queryOne(
    db,
    'SELECT * FROM pregnants WHERE id = $1',
    [pregnancyRow.pregnant_id]
  );
  if (!pregnantRow) throw new PregnancyReportNotFoundError('Gestante nao encontrada');

  const userRow = await queryOne(
    db,
    'SELECT id, name FROM users WHERE id = $1',
    [pregnantRow.user_id]
  );
  const pregnancy = crypto.decryptRecord(pregnancyRow, 'pregnancies');
  const pregnant = crypto.decryptRecord(pregnantRow, 'pregnants');
  const user = userRow ? crypto.decryptRecord(userRow, 'users') : null;

  const examResult = await db.query(
    `SELECT lr.id, lr.document_id, lr.analyte_id, lr.loinc, lr.raw_text,
            lr.original_value, lr.original_unit, lr.original_observed_at,
            lr.value, lr.unit, lr.reference_low, lr.reference_high,
            lr.observed_at, lr.exam_type, lr.timepoint, lr.status,
            lr.reviewed_at, d.document_name
       FROM lab_results lr
       LEFT JOIN pregnant_documents d ON d.id = lr.document_id
      WHERE lr.pregnant_id = $1
        AND lr.status = ANY($2::text[])
      ORDER BY lr.observed_at DESC NULLS LAST, lr.id DESC`,
    [pregnant.id, REVIEWED_EXAM_STATUSES]
  );
  const exams = examResult.rows.map((row) => {
    const lab = crypto.decryptRecord(row, 'lab_results');
    const document = crypto.decryptRecord({ document_name: row.document_name }, 'pregnant_documents');
    return stripSensitiveColumns({
      ...lab,
      document_name: document.document_name,
    }, [
      'id', 'document_id', 'document_name', 'analyte_id', 'loinc', 'value', 'unit',
      'reference_low', 'reference_high', 'observed_at', 'exam_type', 'timepoint',
      'status', 'reviewed_at',
    ]);
  });

  const diaryResult = await db.query(
    `SELECT * FROM daily_entries
      WHERE pregnancy_id = $1
        AND is_current = TRUE
        AND entry_date BETWEEN $2::date AND $3::date
      ORDER BY entry_date DESC, id DESC`,
    [pregnancyId, window.from, window.to]
  );
  const diary = diaryResult.rows.map((row) => serializeEntry(
    crypto.decryptRecord(row, 'daily_entries')
  ));

  const alertsResult = await db.query(
    `SELECT id, rule_id, severity, status, source_type, source_id,
            message, signal_codes, first_seen_at, last_seen_at,
            acknowledged_at
       FROM alert_events
      WHERE pregnancy_id = $1
        AND status IN ('open', 'acknowledged')
      ORDER BY last_seen_at DESC, id DESC`,
    [pregnancyId]
  );
  const alerts = alertsResult.rows.map((row) => ({
    id: row.id,
    rule_id: row.rule_id,
    severity: row.severity,
    status: row.status,
    source_type: row.source_type,
    source_id: row.source_id || null,
    message: row.message,
    signal_codes: Array.isArray(row.signal_codes) ? row.signal_codes : [],
    first_seen_at: row.first_seen_at,
    last_seen_at: row.last_seen_at,
    acknowledged_at: row.acknowledged_at || null,
  }));

  return {
    report_version: REPORT_VERSION,
    generated_at: new Date(generatedAt).toISOString(),
    timezone: window.timezone,
    period: { from: window.from, to: window.to },
    patient: {
      pregnant_id: pregnant.id,
      name: user?.name || null,
      vaccines: section(extractVaccines(pregnant)),
    },
    pregnancy: stripSensitiveColumns(pregnancy, [
      'id', 'pregnant_id', 'weeks', 'is_checked', 'dum', 'dpp', 'ccn', 'dgm',
      'glicemia', 'frequencia_cardiaca', 'altura_uterina', 'regularidade_do_ciclo',
      'ig_ultrassonografia', 'created_at', 'updated_at',
    ]),
    exams: section(exams),
    diary: section(diary),
    alerts: section(alerts),
  };
}

module.exports = {
  DEFAULT_TIMEZONE,
  REPORT_VERSION,
  REVIEWED_EXAM_STATUSES,
  PregnancyReportNotFoundError,
  PregnancyReportValidationError,
  buildDateWindow,
  buildPregnancyReportSnapshot,
  extractVaccines,
  shiftDate,
  validateId,
};
