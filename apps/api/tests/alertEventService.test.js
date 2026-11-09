const test = require('node:test');
const assert = require('node:assert/strict');

const {
  AlertEventValidationError,
  dailyEntryAlerts,
  validateAlertInput,
} = require('../services/alertEventService');

test('diário gera alerta urgente para alarme e pressão crítica', () => {
  const alerts = dailyEntryAlerts({
    alarm_symptoms: ['sangramento'],
    reduced_fetal_movements: true,
    systolic: 165,
    diastolic: 90,
  }, { pregnancyId: 10, pregnantId: 20, sourceId: 'entry-1', weeks: 30 });
  assert.deepEqual(alerts.map(alert => alert.rule_id), [
    'E3-07.bleeding',
    'E3-07.reduced_movements',
    'daily_blood_pressure',
  ]);
  assert.ok(alerts.every(alert => alert.severity === 'red'));
});

test('alerta E3-07 guarda origem, versão da regra e mensagem de atendimento', () => {
  const [alert] = dailyEntryAlerts({ temperature_c: 38.4 }, {
    pregnancyId: 10, pregnantId: 20, sourceId: 'entry-3', weeks: 20,
  });
  assert.equal(alert.rule_id, 'E3-07.fever_38');
  assert.equal(alert.severity, 'red');
  assert.equal(alert.source_type, 'daily_entry');
  assert.equal(alert.source_id, 'entry-3');
  assert.deepEqual(alert.signal_codes, ['temperature_c', 'rule_version:1']);
  assert.match(alert.message, /192/);
  assert.doesNotThrow(() => validateAlertInput(alert));
});

test('mesmo evento repetido gera o mesmo rule_id/severidade (base da idempotência do upsert)', () => {
  const ctx = { pregnancyId: 10, pregnantId: 20, sourceId: 'entry-4', weeks: 20 };
  const first = dailyEntryAlerts({ alarm_symptoms: ['sangramento'] }, ctx);
  const second = dailyEntryAlerts({ alarm_symptoms: ['sangramento'] }, { ...ctx, sourceId: 'entry-5' });
  assert.deepEqual(first.map(a => [a.rule_id, a.severity]), second.map(a => [a.rule_id, a.severity]));
});

test('cefaleia sem PA alta não gera alerta vermelho ao médico', () => {
  const alerts = dailyEntryAlerts({ alarm_symptoms: ['cefaleia_intensa'], systolic: 118, diastolic: 76 }, {
    pregnancyId: 10, pregnantId: 20, sourceId: 'entry-6', weeks: 25,
  });
  assert.deepEqual(alerts.map(a => [a.rule_id, a.severity]), [['E3-07.headache_unconfirmed', 'yellow']]);
});

test('pressão de atenção não é confundida com urgência', () => {
  const alerts = dailyEntryAlerts({ systolic: 145, diastolic: 90 }, {
    pregnancyId: 10, pregnantId: 20, sourceId: 'entry-2',
  });
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].severity, 'yellow');
});

test('valida contrato mínimo de evento', () => {
  assert.throws(
    () => validateAlertInput({ pregnancy_id: 1, pregnant_id: 2, rule_id: 'x', severity: 'blue', source_type: 'daily_entry', message: 'x' }),
    error => error instanceof AlertEventValidationError
  );
});
