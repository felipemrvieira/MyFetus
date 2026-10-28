const test = require('node:test');
const assert = require('node:assert/strict');

const { buildDailyRiskFeed, evaluateDailyEntry } = require('../services/dailyRiskFeedService');

test('sinais de alarme e pressão entram no feed, glicemia e peso ficam no histórico', () => {
  const result = evaluateDailyEntry({
    alarm_symptoms: ['sangramento'],
    reduced_fetal_movements: false,
    systolic: 145,
    diastolic: 90,
    weight_kg: 70,
    glucose_mg_dl: 130,
  });
  assert.equal(result.level, 'red');
  assert.deepEqual(result.signals.map(signal => signal.code), ['alarm_sangramento', 'blood_pressure_elevated']);
  assert.equal(result.history.weight_kg, 70);
  assert.equal(result.history.glucose_mg_dl, 130);
});

test('feed ordena entradas por data e não cria alerta para peso/glicemia isolados', () => {
  const result = buildDailyRiskFeed([
    { entry_key: 'old', entry_date: '2026-10-27', version: 1, weight_kg: 70, glucose_mg_dl: 100 },
    { entry_key: 'new', entry_date: '2026-10-28', version: 1, weight_kg: 71, glucose_mg_dl: 200 },
  ]);
  assert.deepEqual(result.map(entry => entry.entry_key), ['new', 'old']);
  assert.equal(result[0].level, 'green');
  assert.deepEqual(result[0].signals, []);
});
