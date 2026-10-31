const test = require('node:test');
const assert = require('node:assert/strict');

const { parseExamText } = require('../services/labResultParser');

test('extrai hemograma sintético com decimal brasileiro, unidade e data', () => {
  const result = parseExamText(`
    Data do exame: 12/10/2026
    Hemoglobina: 12,5 g/dL Ref: 11,0 a 15,0
    Hematócrito: 37 % Ref: 33 a 44
    Leucócitos: 8,2 10^3/uL
    Plaquetas: 245 10^3/uL
  `);

  assert.equal(result.summary.total_recognized, 4);
  assert.equal(result.summary.accepted, 4);
  assert.equal(result.results[0].loinc, '718-7');
  assert.equal(result.results[0].value_numeric, 12.5);
  assert.equal(result.results[0].observed_at, '2026-10-12');
  assert.equal(result.results[0].reference_low, 11);
  assert.equal(result.results[0].reference_high, 15);
});

test('identifica jejum e ponto do TOTG sem criar limiar clínico', () => {
  const result = parseExamText(`
    Data do exame: 2026-10-12
    Glicemia de jejum: 95 mg/dL
    Glicemia TOTG 75g 1h: 160 mg/dL
  `);

  assert.equal(result.summary.accepted, 2);
  assert.equal(result.results[0].exam_type, 'fasting');
  assert.equal(result.results[1].exam_type, 'ogtt75g');
  assert.equal(result.results[1].timepoint, '1h');
});

test('preserva resultado não mapeado/ambíguo para revisão e não o aceita', () => {
  const result = parseExamText(`
    Data do exame: 12/10/2026
    Proteína urinária: traços
    Campo não reconhecido: 123
  `);

  assert.equal(result.summary.accepted, 0);
  assert.equal(result.results[0].status, 'pending_review');
  assert.equal(result.results[0].ambiguity_reason, 'loinc_not_confirmed');
  assert.deepEqual(result.unrecognized_text, ['Campo não reconhecido: 123']);
});

test('data ausente e unidade ausente impedem aceitação silenciosa', () => {
  const result = parseExamText('Hb: 12,5');
  assert.equal(result.results[0].status, 'pending_review');
  assert.equal(result.results[0].ambiguity_reason, 'unit_not_confirmed');
  assert.equal(result.results[0].observed_at, null);
});

test('data inválida não é estimada', () => {
  const result = parseExamText('Data do exame: 31/02/2026\nHb: 12,5 g/dL');
  assert.equal(result.results[0].status, 'pending_review');
  assert.equal(result.results[0].ambiguity_reason, 'exam_date_not_found');
});

test('glicemia só recebe o tipo quando ele está escrito na linha', () => {
  const result = parseExamText(`
    Data do exame: 2026-10-12
    Glicose: 110 mg/dL
    Glicemia casual: 150 mg/dL
    Glicemia TOTG 75 g jejum: 90 mg/dL
  `);

  assert.deepEqual(
    result.results.map((item) => [item.exam_type, item.timepoint]),
    [[null, null], ['casual', null], ['ogtt75g', '0h']]
  );
});
