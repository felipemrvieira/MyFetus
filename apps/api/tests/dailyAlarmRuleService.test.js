const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildAlarmAuditDetail,
  DAILY_ALARM_CATALOG_VERSION,
  DAILY_ALARM_RULE_IDS,
  evaluateDailyAlarms,
} = require('../services/dailyAlarmRuleService');

const ids = (result) => result.triggered.map((item) => item.rule_id);

test('catálogo clínico aprovado tem versão e IDs versionados', () => {
  assert.match(DAILY_ALARM_CATALOG_VERSION, /^\d+\.\d+\.\d+$/);
  assert.ok(DAILY_ALARM_RULE_IDS.every((id) => id.startsWith('E3-07.')));
  const result = evaluateDailyAlarms({ alarm_symptoms: ['sangramento'] }, { weeks: 20 });
  assert.equal(result.triggered[0].version, 1);
  assert.equal(result.catalog_version, DAILY_ALARM_CATALOG_VERSION);
});

test('cada sinal aprovado gera vermelho e a orientação clínica exata', () => {
  const cases = [
    ['sangramento', 'E3-07.bleeding'],
    ['perda_liquido', 'E3-07.fluid_loss'],
    ['cefaleia_intensa', 'E3-07.severe_headache'],
    ['febre', 'E3-07.fever'],
    ['contracoes', 'E3-07.contractions_or_abdominal_pain'],
    ['desmaio_convulsao', 'E3-07.fainting_or_seizure'],
  ];
  for (const [symptom, ruleId] of cases) {
    const result = evaluateDailyAlarms({ alarm_symptoms: [symptom] }, { weeks: 37 });
    assert.equal(result.level, 'red', symptom);
    assert.deepEqual(ids(result), [ruleId]);
    assert.equal(result.orientation.patient, 'Procure agora a maternidade ou ligue 192 (SAMU). Este aviso não substitui avaliação profissional.');
    assert.deepEqual(result.pending, []);
  }
});

test('cefaleia não depende de pressão arterial', () => {
  const result = evaluateDailyAlarms({ alarm_symptoms: ['cefaleia_intensa'], systolic: 118, diastolic: 76 }, { weeks: 25 });
  assert.equal(result.level, 'red');
  assert.deepEqual(ids(result), ['E3-07.severe_headache']);
});

test('pressão alta isolada continua pertencendo ao motor de pressão', () => {
  const result = evaluateDailyAlarms({ systolic: 165, diastolic: 100 }, { weeks: 25 });
  assert.deepEqual(ids(result), []);
  assert.equal(result.level, 'green');
});

test('febre medida ou marcada é urgente sem pendência de temperatura', () => {
  assert.deepEqual(ids(evaluateDailyAlarms({ temperature_c: 38 }, { weeks: 20 })), ['E3-07.fever']);
  assert.deepEqual(ids(evaluateDailyAlarms({ alarm_symptoms: ['febre'], temperature_c: 37.5 }, { weeks: 20 })), ['E3-07.fever']);
  assert.deepEqual(evaluateDailyAlarms({ alarm_symptoms: ['febre'] }, { weeks: 20 }).pending, []);
});

test('contrações são urgentes em qualquer idade gestacional', () => {
  for (const weeks of [null, 20, 36.9, 37, 40]) {
    const result = evaluateDailyAlarms({ alarm_symptoms: ['contracoes'] }, { weeks });
    assert.equal(result.level, 'red', String(weeks));
    assert.deepEqual(ids(result), ['E3-07.contractions_or_abdominal_pain']);
  }
});

test('redução de movimentos só é avaliada a partir de 28 semanas', () => {
  assert.deepEqual(ids(evaluateDailyAlarms({ reduced_fetal_movements: true }, { weeks: 27 })), []);
  assert.deepEqual(ids(evaluateDailyAlarms({ reduced_fetal_movements: true }, { weeks: 28 })), ['E3-07.reduced_movements']);
  assert.equal(evaluateDailyAlarms({ reduced_fetal_movements: true }, { weeks: 28 }).level, 'red');
});

test('sinais combinados geram uma regra por sinal e nível vermelho', () => {
  const result = evaluateDailyAlarms({
    alarm_symptoms: ['sangramento', 'cefaleia_intensa', 'contracoes', 'desmaio_convulsao'],
    temperature_c: 38.5,
    reduced_fetal_movements: true,
  }, { weeks: 32 });
  assert.equal(result.level, 'red');
  assert.deepEqual(ids(result), [
    'E3-07.bleeding',
    'E3-07.severe_headache',
    'E3-07.fever',
    'E3-07.fainting_or_seizure',
    'E3-07.contractions_or_abdominal_pain',
    'E3-07.reduced_movements',
  ]);
});

test('dados sem sinal não geram alerta', () => {
  for (const entry of [{}, { weight_kg: 70 }, { other_symptoms: ['enjoo'] }, { alarm_symptoms: null }]) {
    const result = evaluateDailyAlarms(entry, { weeks: 20 });
    assert.equal(result.level, 'green');
    assert.equal(result.orientation, null);
    assert.deepEqual(result.triggered, []);
  }
});

test('auditoria registra regra, códigos e orientação sem texto livre ou valores', () => {
  const evaluation = evaluateDailyAlarms({
    alarm_symptoms: ['sangramento'],
    temperature_c: 38.6,
    free_text: 'Maria, CPF 123.456.789-00',
  }, { weeks: 30 });
  const detail = buildAlarmAuditDetail(evaluation, { pregnancyId: 11, alertEventIds: [5, 6] });
  assert.deepEqual(detail.rule_ids, ['E3-07.bleeding@1', 'E3-07.fever@1']);
  assert.deepEqual(detail.signal_codes, ['sangramento', 'temperature_c']);
  assert.equal(detail.orientation_id, 'seek_care_now_v1');
  assert.deepEqual(detail.alert_event_ids, [5, 6]);
  const serialized = JSON.stringify(detail);
  assert.doesNotMatch(serialized, /Maria|123\.456|38\.6/);
});
