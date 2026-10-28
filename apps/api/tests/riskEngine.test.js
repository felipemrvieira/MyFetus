const test = require('node:test');
const assert = require('node:assert/strict');

const {
  RiskEngineError,
  evaluateRisk,
  loadCatalog,
  validateCatalog,
} = require('../services/riskEngine');

test('catálogo de risco tem exatamente 12 categorias e versão válida', () => {
  const catalog = loadCatalog();
  assert.equal(catalog.categories.length, 12);
  assert.equal(validateCatalog(catalog), true);
});

test('motor é determinístico e retorna evidência, severidade e ação', () => {
  const input = {
    maternalAge: 36,
    systolic: 165,
    diastolic: 95,
    glucoseType: 'fasting',
    glucoseValue: 100,
    prePregnancyBmi: 24,
    gestationalWeeks: 22,
    fetalHeartRate: 145,
    familyHistory: false,
    clinicalHistory: false,
    previousPregnancyRisk: false,
    currentPregnancyFlags: [],
    vaccinationStatus: 'regular',
    fundalHeight: 22,
    fundalHeightPercentile: 50,
  };

  const first = evaluateRisk(input);
  const second = evaluateRisk(input);
  assert.deepEqual(first, second);
  assert.equal(first.overallSeverity, 'red');
  const bloodPressure = first.categories.find(category => category.category === 'blood_pressure');
  assert.equal(bloodPressure.alerts[0].ruleId, 'blood_pressure_severe');
  assert.ok(bloodPressure.alerts[0].evidence);
  assert.ok(bloodPressure.alerts[0].suggestedAction);
});

test('dado ausente fica pendente e não é tratado como normal', () => {
  const result = evaluateRisk({});
  const maternalAge = result.categories.find(category => category.category === 'maternal_age');
  assert.equal(maternalAge.status, 'pending_data');
  assert.equal(maternalAge.severity, 'pending');
  assert.deepEqual(maternalAge.missingFields, ['maternalAge']);
  assert.equal(result.overallSeverity, 'green');
});

test('limite inválido falha explicitamente', () => {
  assert.throws(
    () => evaluateRisk({ maternalAge: 36, systolic: 500 }),
    error => error instanceof RiskEngineError && error.code === 'INVALID_VALUE'
  );
});

test('categorias com dados aprovados são avaliadas pelo contrato clínico', () => {
  const result = evaluateRisk({
    maternalAge: 36,
    systolic: 120,
    diastolic: 80,
    glucoseType: 'fasting',
    glucoseValue: 90,
    prePregnancyBmi: 22,
    gestationalWeeks: 20,
    fetalHeartRate: 140,
    familyHistory: false,
    clinicalHistory: false,
    previousPregnancyRisk: false,
    currentPregnancyFlags: [],
    vaccinationStatus: 'regular',
    fundalHeight: 20,
    fundalHeightPercentile: 50
  });
  assert.equal(result.categories.find(category => category.category === 'fundal_height').status, 'no_alert');
  assert.equal(result.categories.find(category => category.category === 'vaccination').status, 'no_alert');
});
