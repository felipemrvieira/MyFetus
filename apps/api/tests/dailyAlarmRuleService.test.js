const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildAlarmAuditDetail,
  DAILY_ALARM_CATALOG_VERSION,
  DAILY_ALARM_RULE_IDS,
  evaluateDailyAlarms,
} = require('../services/dailyAlarmRuleService');

const ids = (result) => result.triggered.map((item) => item.rule_id);

test('catálogo tem versão e IDs versionados', () => {
  assert.match(DAILY_ALARM_CATALOG_VERSION, /^\d+\.\d+\.\d+$/);
  assert.ok(DAILY_ALARM_RULE_IDS.every((id) => id.startsWith('E3-07.')));
  const result = evaluateDailyAlarms({ alarm_symptoms: ['sangramento'] }, { weeks: 20 });
  assert.equal(result.triggered[0].version, 1);
  assert.equal(result.catalog_version, DAILY_ALARM_CATALOG_VERSION);
});

test('sangramento isolado é vermelho com orientação de procurar atendimento', () => {
  const result = evaluateDailyAlarms({ alarm_symptoms: ['sangramento'] }, { weeks: 20 });
  assert.equal(result.level, 'red');
  assert.deepEqual(ids(result), ['E3-07.bleeding']);
  assert.equal(result.orientation.id, 'seek_care_now_v1');
  assert.match(result.orientation.patient, /192/);
  assert.match(result.orientation.disclaimer, /não substitui/);
});

test('perda de líquido isolada é vermelho', () => {
  const result = evaluateDailyAlarms({ alarm_symptoms: ['perda_liquido'] }, { weeks: 30 });
  assert.equal(result.level, 'red');
  assert.deepEqual(ids(result), ['E3-07.fluid_loss']);
});

test('cefaleia intensa + PA alta é vermelho (sistólica ou diastólica)', () => {
  for (const [systolic, diastolic] of [[150, 80], [120, 95], [140, null], [null, 90]]) {
    const result = evaluateDailyAlarms({ alarm_symptoms: ['cefaleia_intensa'], systolic, diastolic }, { weeks: 25 });
    assert.equal(result.level, 'red', `${systolic}/${diastolic}`);
    assert.deepEqual(ids(result), ['E3-07.headache_high_bp']);
  }
});

test('cefaleia com PA normal não é vermelho, mas orienta avaliação', () => {
  const result = evaluateDailyAlarms({ alarm_symptoms: ['cefaleia_intensa'], systolic: 120, diastolic: 80 }, { weeks: 25 });
  assert.equal(result.level, 'yellow');
  assert.deepEqual(ids(result), ['E3-07.headache_unconfirmed']);
  assert.equal(result.orientation.id, 'seek_evaluation_v1');
  assert.deepEqual(result.pending, []);
});

test('cefaleia sem PA informada fica amarela com dado pendente', () => {
  const result = evaluateDailyAlarms({ alarm_symptoms: ['cefaleia_intensa'] }, { weeks: 25 });
  assert.equal(result.level, 'yellow');
  assert.deepEqual(result.pending, ['blood_pressure_missing']);
});

test('PA alta isolada não dispara regra de cefaleia', () => {
  const result = evaluateDailyAlarms({ systolic: 165, diastolic: 100 }, { weeks: 25 });
  assert.deepEqual(ids(result), []);
  assert.equal(result.level, 'green');
});

test('febre: limiar exato de 38 °C', () => {
  assert.deepEqual(ids(evaluateDailyAlarms({ temperature_c: 38 }, { weeks: 20 })), ['E3-07.fever_38']);
  assert.equal(evaluateDailyAlarms({ temperature_c: 38 }, { weeks: 20 }).level, 'red');
  assert.equal(evaluateDailyAlarms({ temperature_c: 37.9 }, { weeks: 20 }).level, 'green');
  assert.equal(evaluateDailyAlarms({ alarm_symptoms: ['febre'], temperature_c: 39.1 }, { weeks: 20 }).level, 'red');
});

test('febre marcada sem temperatura não é descartada', () => {
  const result = evaluateDailyAlarms({ alarm_symptoms: ['febre'] }, { weeks: 20 });
  assert.equal(result.level, 'yellow');
  assert.deepEqual(ids(result), ['E3-07.fever_unmeasured']);
  assert.deepEqual(result.pending, ['temperature_missing']);
});

test('febre marcada com temperatura medida abaixo de 38 não é alarme', () => {
  const result = evaluateDailyAlarms({ alarm_symptoms: ['febre'], temperature_c: 37.5 }, { weeks: 20 });
  assert.equal(result.level, 'green');
});

test('contrações: < 37 semanas vermelho, >= 37 amarelo', () => {
  assert.deepEqual(ids(evaluateDailyAlarms({ alarm_symptoms: ['contracoes'] }, { weeks: 36.9 })), ['E3-07.preterm_contractions']);
  assert.equal(evaluateDailyAlarms({ alarm_symptoms: ['contracoes'] }, { weeks: 36 }).level, 'red');
  const term = evaluateDailyAlarms({ alarm_symptoms: ['contracoes'] }, { weeks: 37 });
  assert.equal(term.level, 'yellow');
  assert.deepEqual(ids(term), ['E3-07.term_contractions']);
});

test('contrações com IG desconhecida são tratadas como vermelho e registram pendência', () => {
  const result = evaluateDailyAlarms({ alarm_symptoms: ['contracoes'] }, { weeks: null });
  assert.equal(result.level, 'red');
  assert.deepEqual(result.pending, ['gestational_age_unknown']);
});

test('redução de movimentos é vermelho', () => {
  const result = evaluateDailyAlarms({ reduced_fetal_movements: true }, { weeks: 30 });
  assert.equal(result.level, 'red');
  assert.deepEqual(ids(result), ['E3-07.reduced_movements']);
  assert.equal(evaluateDailyAlarms({ reduced_fetal_movements: false }, { weeks: 30 }).level, 'green');
});

test('sintomas combinados geram uma regra por sinal e nível vermelho', () => {
  const result = evaluateDailyAlarms({
    alarm_symptoms: ['sangramento', 'cefaleia_intensa', 'contracoes'],
    systolic: 150,
    temperature_c: 38.5,
    reduced_fetal_movements: true,
  }, { weeks: 32 });
  assert.equal(result.level, 'red');
  assert.deepEqual(ids(result), [
    'E3-07.bleeding',
    'E3-07.headache_high_bp',
    'E3-07.fever_38',
    'E3-07.preterm_contractions',
    'E3-07.reduced_movements',
  ]);
});

test('dados faltantes ou sem sinal não geram alerta nem falsa garantia', () => {
  for (const entry of [{}, { weight_kg: 70 }, { other_symptoms: ['enjoo'] }, { alarm_symptoms: null }]) {
    const result = evaluateDailyAlarms(entry, { weeks: 20 });
    assert.equal(result.level, 'green');
    assert.equal(result.orientation, null);
    assert.deepEqual(result.triggered, []);
  }
});

test('auditoria registra regra, dado e orientação exibida, sem texto livre nem valores', () => {
  const evaluation = evaluateDailyAlarms({
    alarm_symptoms: ['sangramento'],
    temperature_c: 38.6,
    free_text: 'Maria, CPF 123.456.789-00',
  }, { weeks: 30 });
  const detail = buildAlarmAuditDetail(evaluation, { pregnancyId: 11, alertEventIds: [5, 6] });
  assert.deepEqual(detail.rule_ids, ['E3-07.bleeding@1', 'E3-07.fever_38@1']);
  assert.deepEqual(detail.signal_codes, ['sangramento', 'temperature_c']);
  assert.equal(detail.orientation_id, 'seek_care_now_v1');
  assert.deepEqual(detail.alert_event_ids, [5, 6]);
  const serialized = JSON.stringify(detail);
  assert.doesNotMatch(serialized, /Maria|123\.456|38\.6/);
});
