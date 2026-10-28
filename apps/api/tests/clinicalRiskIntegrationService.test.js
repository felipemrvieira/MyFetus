const test = require('node:test');
const assert = require('node:assert/strict');

const {
  acceptedObservations,
  buildObservationAlerts,
} = require('../services/clinicalRiskIntegrationService');

test('recalcula somente observações aceitas', () => {
  const observations = acceptedObservations([
    { source_id: 'pending-1', analyte: 'glicemia', value: 250, status: 'pending_review' },
    { source_id: 'accepted-1', analyte: 'glicemia', value: 250, status: 'accepted', glucose_type: 'casual' },
  ]);
  assert.equal(observations.length, 1);
  assert.equal(observations[0].source_id, 'accepted-1');
});

test('gera sinais de exame aceito por gravidade e idade gestacional', () => {
  const alerts = buildObservationAlerts([
    { source_id: 'bp-1', analyte: 'systolic', value: 165, unit: 'mmHg', status: 'accepted' },
    { source_id: 'fcf-1', analyte: 'fcf', value: 105, unit: 'bpm', status: 'accepted' },
  ], { pregnancyId: 1, pregnantId: 2, gestationalWeeks: 22 });
  assert.equal(alerts.some(alert => alert.rule_id === 'exam_blood_pressure' && alert.severity === 'red'), true);
  assert.equal(alerts.some(alert => alert.rule_id === 'exam_fetal_heart_rate' && alert.severity === 'red'), true);
});
