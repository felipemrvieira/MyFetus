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
  }, { pregnancyId: 10, pregnantId: 20, sourceId: 'entry-1' });
  assert.deepEqual(alerts.map(alert => alert.rule_id), [
    'daily_sangramento',
    'daily_reduced_fetal_movements',
    'daily_blood_pressure',
  ]);
  assert.ok(alerts.every(alert => alert.severity === 'red'));
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
