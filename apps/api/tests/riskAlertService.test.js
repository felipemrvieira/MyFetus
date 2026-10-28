const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildRiskInput,
  calculateAge,
  evaluatePatientRisk,
} = require('../services/riskAlertService');

test('monta a entrada clínica usando apenas campos disponíveis e não inventa tipo de glicemia', () => {
  const input = buildRiskInput({
    birthdate: '1990-01-01',
    pressao_sistole: 160,
    pressao_diastole: 90,
    peso_pregestacional: 80,
    altura: 1.6,
  }, {
    weeks: 22,
    glicemia: 200,
    frequencia_cardiaca: 100,
  }, { now: new Date('2026-10-28T12:00:00Z') });

  assert.equal(input.maternalAge, 36);
  assert.equal(input.systolic, 160);
  assert.equal(input.diastolic, 90);
  assert.ok(Math.abs(input.prePregnancyBmi - 31.25) < 0.000001);
  assert.equal(input.gestationalWeeks, 22);
  assert.equal('fetalHeartRate' in input, false);
  assert.equal('glucoseType' in input, false);
});

test('avalia o alerta pelo catálogo e preserva pendências sem tratá-las como verdes', () => {
  const result = evaluatePatientRisk({
    birthdate: '1990-01-01',
    pressao_sistole: 160,
    pressao_diastole: 90,
  }, { weeks: 22, frequencia_cardiaca: 145 }, { now: new Date('2026-10-28T12:00:00Z') });

  assert.equal(result.overall_level, 'red');
  assert.equal(result.categories.pressao_arterial.level, 'red');
  assert.equal(result.categories.altura_uterina.level, 'pending');
  assert.equal(result.alert_counts.pending > 0, true);
  assert.equal(result.categories.semanas_gestacao.status, 'no_alert');
});

test('calcula idade sem gerar idade negativa para data futura', () => {
  assert.equal(calculateAge('2030-01-01', new Date('2026-10-28T12:00:00Z')), undefined);
  assert.equal(calculateAge('2000-10-28', new Date('2026-10-28T12:00:00Z')), 26);
});

test('aplica política aprovada por idade gestacional e identifica a fonte', () => {
  const result = evaluatePatientRisk(
    { birthdate: '1990-01-01', antecedentes_gemelar: true },
    { weeks: 18, dum: '2026-06-01', ig_ultrassonografia: '2026-05-20' },
    { now: new Date('2026-10-28T12:00:00Z') }
  );

  assert.equal(result.gestational_rule_context.source, 'ultrassom');
  assert.equal(result.gestational_rule_context.multiplePregnancy, true);
  assert.equal(result.categories.altura_uterina.status, 'not_applicable');
  assert.equal(result.categories.frequencia_cardiaca_fetal.status, 'not_applicable');
  assert.match(result.categories.altura_uterina.detail, /gestação múltipla/);
});

test('não aplica regras por IG antes de seis semanas', () => {
  const result = evaluatePatientRisk(
    { birthdate: '1990-01-01' },
    { weeks: 5, dum: '2026-09-20' },
    { now: new Date('2026-10-28T12:00:00Z') }
  );

  assert.equal(result.gestational_rule_context.hasRuleByWeek, false);
  assert.equal(result.categories.semanas_gestacao.status, 'not_applicable');
  assert.equal(result.categories.vacinas.status, 'not_applicable');
});
