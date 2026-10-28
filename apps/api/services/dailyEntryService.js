const { randomUUID } = require('node:crypto');

const ALARM_SYMPTOMS = Object.freeze([
  'sangramento',
  'perda_liquido',
  'cefaleia_intensa',
  'febre',
  'contracoes',
]);

const OTHER_SYMPTOMS = Object.freeze([
  'enjoo',
  'azia',
  'dor_costas',
  'inchaco_leve',
  'cansaco',
]);

class DailyEntryValidationError extends Error {}

function validateId(value, field) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw new DailyEntryValidationError(`${field} invalido`);
  }
  return id;
}

function validateDate(value, field = 'entry_date') {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new DailyEntryValidationError(`${field} deve estar no formato YYYY-MM-DD`);
  }
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new DailyEntryValidationError(`${field} deve ser uma data valida`);
  }
  return value;
}

function optionalNumber(value, field, { min, max }) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new DailyEntryValidationError(`${field} deve estar entre ${min} e ${max}`);
  }
  return value;
}

function optionalText(value, field, maxLength) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || value.trim().length > maxLength) {
    throw new DailyEntryValidationError(`${field} deve ter no maximo ${maxLength} caracteres`);
  }
  return value.trim() || null;
}

function optionalBoolean(value, field) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'boolean') {
    throw new DailyEntryValidationError(`${field} deve ser booleano`);
  }
  return value;
}

function symptomList(value, field, allowed) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !allowed.includes(item))) {
    throw new DailyEntryValidationError(`${field} possui sintoma invalido`);
  }
  return [...new Set(value)];
}

function normalizePayload(payload = {}, gestationalWeeks) {
  const entry = {
    entry_date: validateDate(payload.entry_date),
    timezone: optionalText(payload.timezone || 'America/Recife', 'timezone', 80),
    alarm_symptoms: symptomList(payload.alarm_symptoms, 'alarm_symptoms', ALARM_SYMPTOMS),
    other_symptoms: symptomList(payload.other_symptoms, 'other_symptoms', OTHER_SYMPTOMS),
    free_text: optionalText(payload.free_text, 'free_text', 500),
    systolic: optionalNumber(payload.systolic, 'systolic', { min: 60, max: 260 }),
    diastolic: optionalNumber(payload.diastolic, 'diastolic', { min: 30, max: 160 }),
    weight_kg: optionalNumber(payload.weight_kg, 'weight_kg', { min: 30, max: 250 }),
    glucose_mg_dl: optionalNumber(payload.glucose_mg_dl, 'glucose_mg_dl', { min: 20, max: 600 }),
    reduced_fetal_movements: optionalBoolean(payload.reduced_fetal_movements, 'reduced_fetal_movements'),
  };

  if (gestationalWeeks !== null && gestationalWeeks !== undefined && Number(gestationalWeeks) < 28) {
    if (entry.reduced_fetal_movements !== null) {
      throw new DailyEntryValidationError(
        'reduced_fetal_movements so pode ser informado a partir de 28 semanas'
      );
    }
  }

  const hasData = entry.alarm_symptoms.length > 0 ||
    entry.other_symptoms.length > 0 ||
    entry.free_text !== null ||
    entry.systolic !== null ||
    entry.diastolic !== null ||
    entry.weight_kg !== null ||
    entry.glucose_mg_dl !== null ||
    entry.reduced_fetal_movements !== null;

  if (!hasData) {
    throw new DailyEntryValidationError('informe pelo menos um dado do diario');
  }
  return entry;
}

function toEncryptedFields(entry) {
  return {
    alarm_symptoms: JSON.stringify(entry.alarm_symptoms),
    other_symptoms: JSON.stringify(entry.other_symptoms),
    free_text: entry.free_text,
    systolic: entry.systolic,
    diastolic: entry.diastolic,
    weight_kg: entry.weight_kg,
    glucose_mg_dl: entry.glucose_mg_dl,
    reduced_fetal_movements: entry.reduced_fetal_movements,
  };
}

function decryptJsonList(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string' || !value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function serializeEntry(row) {
  return {
    id: row.id,
    entry_key: row.entry_key,
    pregnant_id: row.pregnant_id,
    pregnancy_id: row.pregnancy_id,
    entry_date: row.entry_date,
    timezone: row.timezone,
    version: row.version,
    alarm_symptoms: decryptJsonList(row.alarm_symptoms),
    other_symptoms: decryptJsonList(row.other_symptoms),
    free_text: row.free_text || null,
    systolic: row.systolic === null || row.systolic === undefined || row.systolic === '' ? null : Number(row.systolic),
    diastolic: row.diastolic === null || row.diastolic === undefined || row.diastolic === '' ? null : Number(row.diastolic),
    weight_kg: row.weight_kg === null || row.weight_kg === undefined || row.weight_kg === '' ? null : Number(row.weight_kg),
    glucose_mg_dl: row.glucose_mg_dl === null || row.glucose_mg_dl === undefined || row.glucose_mg_dl === '' ? null : Number(row.glucose_mg_dl),
    reduced_fetal_movements: row.reduced_fetal_movements === null || row.reduced_fetal_movements === undefined || row.reduced_fetal_movements === ''
      ? null
      : row.reduced_fetal_movements === true || row.reduced_fetal_movements === 'true',
    created_by_user_id: row.created_by_user_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function buildEntryKey() {
  return randomUUID();
}

module.exports = {
  ALARM_SYMPTOMS,
  OTHER_SYMPTOMS,
  DailyEntryValidationError,
  buildEntryKey,
  decryptJsonList,
  normalizePayload,
  serializeEntry,
  toEncryptedFields,
  validateDate,
  validateId,
};
