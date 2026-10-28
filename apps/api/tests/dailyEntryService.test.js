const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DailyEntryValidationError,
  normalizePayload,
  serializeEntry,
} = require('../services/dailyEntryService');

test('normaliza um registro diário com os campos aprovados pelo PO', () => {
  const entry = normalizePayload({
    entry_date: '2026-10-28',
    timezone: 'America/Recife',
    alarm_symptoms: ['sangramento'],
    other_symptoms: ['azia'],
    free_text: 'Observação curta',
    systolic: 120,
    diastolic: 80,
    weight_kg: 68.4,
    glucose_mg_dl: 92,
    reduced_fetal_movements: true,
  }, 30);

  assert.deepEqual(entry.alarm_symptoms, ['sangramento']);
  assert.equal(entry.weight_kg, 68.4);
  assert.equal(entry.reduced_fetal_movements, true);
});

test('exige data e pelo menos um dado', () => {
  assert.throws(
    () => normalizePayload({ entry_date: '2026-10-28' }, 20),
    DailyEntryValidationError
  );
  assert.throws(
    () => normalizePayload({ entry_date: '2026-02-30', weight_kg: 70 }, 20),
    /data valida/
  );
});

test('aplica as faixas de digitação sem transformar validação em alerta', () => {
  assert.throws(() => normalizePayload({ entry_date: '2026-10-28', systolic: 59 }, 20), /systolic/);
  assert.throws(() => normalizePayload({ entry_date: '2026-10-28', glucose_mg_dl: 601 }, 20), /glucose_mg_dl/);
  assert.throws(() => normalizePayload({ entry_date: '2026-10-28', reduced_fetal_movements: false }, 27), /28 semanas/);
});

test('serializa valores descriptografados para o contrato da API', () => {
  const result = serializeEntry({
    id: 10,
    entry_key: 'key-1',
    pregnant_id: 2,
    pregnancy_id: 3,
    entry_date: '2026-10-28',
    timezone: 'America/Recife',
    version: 2,
    alarm_symptoms: '["febre"]',
    other_symptoms: '[]',
    systolic: '120',
    diastolic: null,
    weight_kg: '68.4',
    glucose_mg_dl: null,
    reduced_fetal_movements: 'false',
    created_by_user_id: 8,
  });

  assert.deepEqual(result.alarm_symptoms, ['febre']);
  assert.equal(result.systolic, 120);
  assert.equal(result.reduced_fetal_movements, false);
});
