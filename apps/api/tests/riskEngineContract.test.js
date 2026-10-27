const test = require('node:test');
const assert = require('node:assert/strict');

const fixtures = require('../data/risk-regression-fixtures.json');
const {
  RiskEngineError,
  evaluateRisk,
  loadCatalog,
} = require('../services/riskEngine');

const catalog = loadCatalog();
const BASELINE_INPUT = {
  maternalAge: 30,
  systolic: 120,
  diastolic: 80,
  glucoseType: 'fasting',
  glucoseValue: 80,
  prePregnancyBmi: 22,
  fundalHeight: 20,
  gestationalWeeks: 20,
  fundalHeightPercentile: 50,
  fetalHeartRate: 140,
  familyHistory: false,
  clinicalHistory: false,
  previousPregnancyRisk: false,
  currentPregnancyFlags: [],
  vaccinationStatus: 'regular',
};

function allRules() {
  return catalog.categories.flatMap(category => category.rules.map(rule => ({
    category: category.id,
    rule,
  })));
}

function categoryResult(result, categoryId) {
  const category = result.categories.find(item => item.category === categoryId);
  assert.ok(category, `categoria ausente no resultado: ${categoryId}`);
  return category;
}

test('catálogo e fixtures têm cobertura exata de todas as regras', () => {
  assert.equal(fixtures.catalogVersion, catalog.catalogVersion);
  assert.match(fixtures.fixtureVersion, /^\d+\.\d+\.\d+$/);

  const catalogRuleIds = allRules().map(({ rule }) => rule.id).sort();
  const fixtureRuleIds = fixtures.cases.flatMap(item => (
    item.expected.alertRuleIds.length > 0 ? item.expected.alertRuleIds : [item.id]
  )).sort();

  assert.deepEqual([...new Set(fixtureRuleIds)].sort(), catalogRuleIds);
});

test('cada regra é exercitada no limite registrado e respeita o status esperado', () => {
  for (const fixture of fixtures.cases) {
    const result = evaluateRisk({ ...BASELINE_INPUT, ...fixture.inputOverrides });
    const category = categoryResult(result, fixture.category);
    assert.equal(category.status, fixture.expected.status, fixture.id);
    assert.deepEqual(
      category.alerts.map(alert => alert.ruleId).sort(),
      [...fixture.expected.alertRuleIds].sort(),
      fixture.id
    );
  }
});

test('baseline normal não cria alerta e categorias pendentes permanecem explicitamente pendentes', () => {
  const result = evaluateRisk(BASELINE_INPUT);

  for (const category of catalog.categories) {
    const actual = categoryResult(result, category.id);
    if (category.decisionStatus) {
      assert.equal(actual.status, 'pending_decision', category.id);
      assert.equal(actual.alerts.length, 0, category.id);
    } else {
      assert.equal(actual.status, 'no_alert', category.id);
      assert.equal(actual.severity, 'green', category.id);
    }
  }
  assert.equal(result.overallSeverity, 'green');
});

test('ausência de dados é pendência por categoria, nunca normalização silenciosa', () => {
  const result = evaluateRisk({});

  for (const category of catalog.categories) {
    const actual = categoryResult(result, category.id);
    if (category.decisionStatus) {
      assert.equal(actual.status, 'pending_decision', category.id);
    } else {
      assert.equal(actual.status, 'pending_data', category.id);
      assert.deepEqual(actual.missingFields, category.requiredFields, category.id);
    }
    assert.equal(actual.alerts.length, 0, category.id);
  }
});

test('faixas plausíveis e tipos inválidos falham de forma explícita', () => {
  const numericFields = new Map();
  for (const category of catalog.categories) {
    for (const [field, definition] of Object.entries(category.fields)) {
      if (typeof definition.min === 'number' && typeof definition.max === 'number') {
        numericFields.set(field, definition);
      }
    }
  }

  for (const [field, definition] of numericFields) {
    assert.throws(
      () => evaluateRisk({ [field]: definition.min - 1 }),
      error => error instanceof RiskEngineError && error.code === 'INVALID_VALUE',
      `${field} abaixo do mínimo`
    );
    assert.throws(
      () => evaluateRisk({ [field]: definition.max + 1 }),
      error => error instanceof RiskEngineError && error.code === 'INVALID_VALUE',
      `${field} acima do máximo`
    );
  }

  assert.throws(
    () => evaluateRisk({ ...BASELINE_INPUT, maternalAge: '30' }),
    error => error instanceof RiskEngineError && error.code === 'INVALID_VALUE'
  );
  assert.throws(
    () => evaluateRisk({ ...BASELINE_INPUT, familyHistory: 'false' }),
    error => error instanceof RiskEngineError && error.code === 'INVALID_VALUE'
  );
  assert.throws(
    () => evaluateRisk({ ...BASELINE_INPUT, currentPregnancyFlags: 'bleeding' }),
    error => error instanceof RiskEngineError && error.code === 'INVALID_VALUE'
  );
});

test('mudança de limiar deixa o contrato detectável por regressão', () => {
  const ageAtBoundary = evaluateRisk({ ...BASELINE_INPUT, maternalAge: 35 });
  const ageBelowBoundary = evaluateRisk({ ...BASELINE_INPUT, maternalAge: 34.99 });
  const ageCategoryAtBoundary = categoryResult(ageAtBoundary, 'maternal_age');
  const ageCategoryBelowBoundary = categoryResult(ageBelowBoundary, 'maternal_age');

  assert.deepEqual(ageCategoryAtBoundary.alerts.map(alert => alert.ruleId), ['maternal_age_35_or_more']);
  assert.deepEqual(ageCategoryBelowBoundary.alerts, []);
});
