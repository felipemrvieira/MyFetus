const cryptoService = require('./cryptoService');

const MAX_EVOLUTION_LENGTH = 10000;
const MAX_CONDUCT_LENGTH = 10000;
const MAX_PRESCRIPTION_LENGTH = 5000;

class ConsultationValidationError extends Error {}
class ConsultationNotFoundError extends Error {}
class ConsultationConflictError extends Error {}

function validateId(value, field = 'id') {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw new ConsultationValidationError(`${field} invalido`);
  }
  return id;
}

function normalizeRequiredText(value, field, maxLength) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ConsultationValidationError(`${field} e obrigatorio`);
  }
  const text = value.trim();
  if (text.length > maxLength) {
    throw new ConsultationValidationError(`${field} excede o limite de ${maxLength} caracteres`);
  }
  return text;
}

function normalizeOptionalText(value, field, maxLength) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') {
    throw new ConsultationValidationError(`${field} deve ser texto`);
  }
  const text = value.trim();
  if (!text) return null;
  if (text.length > maxLength) {
    throw new ConsultationValidationError(`${field} excede o limite de ${maxLength} caracteres`);
  }
  return text;
}

function normalizeConsultationAt(value, { required = true } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw new ConsultationValidationError('consultation_at e obrigatorio');
    return null;
  }
  if (typeof value !== 'string') {
    throw new ConsultationValidationError('consultation_at deve ser uma data ISO');
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new ConsultationValidationError('consultation_at deve ser uma data ISO valida');
  }
  return parsed.toISOString();
}

function normalizeDate(value, field, { required = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw new ConsultationValidationError(`${field} e obrigatorio`);
    return null;
  }
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new ConsultationValidationError(`${field} deve estar no formato YYYY-MM-DD`);
  }
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() !== month - 1
    || parsed.getUTCDate() !== day
  ) {
    throw new ConsultationValidationError(`${field} deve ser uma data valida`);
  }
  return value;
}

function normalizeGestationalAge(value, { required = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw new ConsultationValidationError('gestational_age_weeks e obrigatorio');
    return null;
  }
  const weeks = Number(value);
  if (!Number.isFinite(weeks) || weeks <= 0 || weeks > 45) {
    throw new ConsultationValidationError('gestational_age_weeks deve estar entre 0 e 45');
  }
  return weeks;
}

function validateCreatePayload(payload = {}) {
  return {
    consultation_at: normalizeConsultationAt(payload.consultation_at),
    gestational_age_weeks: normalizeGestationalAge(payload.gestational_age_weeks),
    evolution: normalizeRequiredText(payload.evolution, 'evolution', MAX_EVOLUTION_LENGTH),
    conduct: normalizeRequiredText(payload.conduct, 'conduct', MAX_CONDUCT_LENGTH),
    prescription_text: normalizeOptionalText(
      payload.prescription_text,
      'prescription_text',
      MAX_PRESCRIPTION_LENGTH
    ),
    next_return_at: normalizeDate(payload.next_return_at, 'next_return_at'),
  };
}

function validateAddendumPayload(payload = {}) {
  const allowed = [
    'consultation_at',
    'gestational_age_weeks',
    'evolution',
    'conduct',
    'prescription_text',
    'next_return_at',
  ];
  if (!allowed.some((field) => Object.prototype.hasOwnProperty.call(payload, field))) {
    throw new ConsultationValidationError('Informe ao menos um campo para o adendo');
  }

  const result = {};
  if (Object.prototype.hasOwnProperty.call(payload, 'consultation_at')) {
    result.consultation_at = normalizeConsultationAt(payload.consultation_at);
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'gestational_age_weeks')) {
    result.gestational_age_weeks = normalizeGestationalAge(payload.gestational_age_weeks);
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'evolution')) {
    result.evolution = normalizeRequiredText(payload.evolution, 'evolution', MAX_EVOLUTION_LENGTH);
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'conduct')) {
    result.conduct = normalizeRequiredText(payload.conduct, 'conduct', MAX_CONDUCT_LENGTH);
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'prescription_text')) {
    result.prescription_text = normalizeOptionalText(
      payload.prescription_text,
      'prescription_text',
      MAX_PRESCRIPTION_LENGTH
    );
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'next_return_at')) {
    result.next_return_at = normalizeDate(payload.next_return_at, 'next_return_at');
  }
  return result;
}

function presentConsultation(row, crypto = cryptoService) {
  if (!row) return null;
  const result = crypto.decryptRecord(row, 'consultations');
  if (result.gestational_age_weeks !== null && result.gestational_age_weeks !== undefined) {
    result.gestational_age_weeks = Number(result.gestational_age_weeks);
  }
  return result;
}

async function findConsultation(db, idValue) {
  const id = validateId(idValue, 'consultation_id');
  const result = await db.query('SELECT * FROM consultations WHERE id = $1', [id]);
  return result.rows[0] || null;
}

async function createConsultation(db, pregnancyIdValue, payload, userId, options = {}) {
  const pregnancyId = validateId(pregnancyIdValue, 'pregnancy_id');
  const authorUserId = validateId(userId, 'author_user_id');
  const data = validateCreatePayload(payload);
  const crypto = options.crypto || cryptoService;
  const encrypted = crypto.encryptRecord({
    evolution: data.evolution,
    conduct: data.conduct,
    prescription_text: data.prescription_text,
  }, 'consultations');

  const result = await db.query(
    `INSERT INTO consultations (
       pregnancy_id, author_user_id, version, status, consultation_at,
       gestational_age_weeks, evolution, conduct, prescription_text,
       next_return_at, encryption_key_version
     ) VALUES ($1, $2, 1, 'draft', $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [
      pregnancyId,
      authorUserId,
      data.consultation_at,
      data.gestational_age_weeks,
      encrypted.evolution,
      encrypted.conduct,
      encrypted.prescription_text,
      data.next_return_at,
      crypto.currentVersion || crypto.getCurrentVersion(),
    ]
  );
  return presentConsultation(result.rows[0], crypto);
}

async function listConsultations(db, pregnancyIdValue, query = {}, options = {}) {
  const pregnancyId = validateId(pregnancyIdValue, 'pregnancy_id');
  const limit = query.limit === undefined ? 100 : Number(query.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new ConsultationValidationError('limit deve ser um inteiro entre 1 e 100');
  }
  const result = await db.query(
    `SELECT * FROM consultations
     WHERE pregnancy_id = $1
     ORDER BY consultation_at DESC, id DESC
     LIMIT $2`,
    [pregnancyId, limit]
  );
  const crypto = options.crypto || cryptoService;
  return result.rows.map((row) => presentConsultation(row, crypto));
}

async function getConsultation(db, idValue, options = {}) {
  const row = await findConsultation(db, idValue);
  const crypto = options.crypto || cryptoService;
  return presentConsultation(row, crypto);
}

async function createAddendum(db, parentIdValue, payload, userId, options = {}) {
  const parent = await findConsultation(db, parentIdValue);
  if (!parent) throw new ConsultationNotFoundError('Consulta nao encontrada');
  const crypto = options.crypto || cryptoService;
  const current = presentConsultation(parent, crypto);
  const changes = validateAddendumPayload(payload);
  const data = {
    consultation_at: changes.consultation_at || new Date().toISOString(),
    gestational_age_weeks: Object.prototype.hasOwnProperty.call(changes, 'gestational_age_weeks')
      ? changes.gestational_age_weeks
      : current.gestational_age_weeks,
    evolution: changes.evolution || current.evolution,
    conduct: changes.conduct || current.conduct,
    prescription_text: Object.prototype.hasOwnProperty.call(changes, 'prescription_text')
      ? changes.prescription_text
      : current.prescription_text,
    next_return_at: Object.prototype.hasOwnProperty.call(changes, 'next_return_at')
      ? changes.next_return_at
      : current.next_return_at,
  };
  const encrypted = crypto.encryptRecord({
    evolution: data.evolution,
    conduct: data.conduct,
    prescription_text: data.prescription_text,
  }, 'consultations');
  const result = await db.query(
    `INSERT INTO consultations (
       pregnancy_id, author_user_id, parent_consultation_id, version, status,
       consultation_at, gestational_age_weeks, evolution, conduct,
       prescription_text, next_return_at, encryption_key_version
     ) VALUES ($1, $2, $3, $4, 'draft', $5, $6, $7, $8, $9, $10, $11)
     RETURNING *`,
    [
      parent.pregnancy_id,
      validateId(userId, 'author_user_id'),
      parent.id,
      Number(parent.version || 1) + 1,
      data.consultation_at,
      data.gestational_age_weeks,
      encrypted.evolution,
      encrypted.conduct,
      encrypted.prescription_text,
      data.next_return_at,
      crypto.currentVersion || crypto.getCurrentVersion(),
    ]
  );
  return presentConsultation(result.rows[0], crypto);
}

async function finalizeConsultation(db, idValue, options = {}) {
  const id = validateId(idValue, 'consultation_id');
  const current = await findConsultation(db, id);
  if (!current) throw new ConsultationNotFoundError('Consulta nao encontrada');
  if (current.status === 'finalized') {
    throw new ConsultationConflictError('Consulta ja finalizada; use um adendo para corrigir');
  }
  const result = await db.query(
    `UPDATE consultations
     SET status = 'finalized', finalized_at = CURRENT_TIMESTAMP
     WHERE id = $1 AND status = 'draft'
     RETURNING *`,
    [id]
  );
  if (!result.rows[0]) {
    throw new ConsultationConflictError('Consulta ja foi finalizada; use um adendo para corrigir');
  }
  const crypto = options.crypto || cryptoService;
  return presentConsultation(result.rows[0], crypto);
}

module.exports = {
  ConsultationConflictError,
  ConsultationNotFoundError,
  ConsultationValidationError,
  createAddendum,
  createConsultation,
  finalizeConsultation,
  findConsultation,
  getConsultation,
  listConsultations,
  normalizeConsultationAt,
  normalizeDate,
  presentConsultation,
  validateAddendumPayload,
  validateCreatePayload,
  validateId,
};
