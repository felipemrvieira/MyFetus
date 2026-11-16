import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  LAB_REVIEW_GENERIC_ERROR,
  LabResult,
  availableActions,
  buildReviewBody,
  correctionFormFrom,
  formatDate,
  formatExamContext,
  formatReference,
  formatValue,
  getLabReviewErrorMessage,
  parseDateInput,
  shouldReloadAfterError,
} from '../utils/labReview';

const apiError = (status: number, data: Record<string, unknown> = {}) => ({ response: { status, data } });

function result(overrides: Partial<LabResult> = {}): LabResult {
  const values = {
    value: 10.2,
    unit: 'g/dL',
    reference_low: 11,
    reference_high: 15,
    observed_at: '2026-10-15',
    exam_type: null,
    timepoint: null,
  };
  return {
    id: 1,
    document_id: 900,
    analyte_id: 'hemoglobin',
    analyte: 'Hemoglobina',
    status: 'pending',
    version: 1,
    clinically_usable: false,
    original: values,
    current: values,
    raw_text: 'Hemoglobina: 10,2 g/dL',
    confidence: 0.95,
    low_confidence: false,
    ambiguity_reason: null,
    missing_for_acceptance: [],
    review_reason: null,
    reviewed_at: null,
    ...overrides,
  };
}

const glucose = (current: Partial<LabResult['current']> = {}) => {
  const values = { ...result().current, value: 110, unit: 'mg/dL', reference_low: null, reference_high: null, ...current };
  return result({ analyte_id: 'glucose', analyte: 'Glicemia', current: values, original: values });
};

describe('revisão dos analitos: formatação', () => {
  it('mostra valor, referência, data e tipo da glicemia em português', () => {
    assert.equal(formatValue({ value: 10.2, unit: 'g/dL' }), '10,2 g/dL');
    assert.equal(formatValue({ value: 'positivo', unit: null }), 'positivo');
    assert.equal(formatValue({ value: null, unit: 'g/dL' }), 'Sem valor');
    assert.equal(formatReference({ reference_low: 11, reference_high: 15 }), '11 a 15');
    assert.equal(formatReference({ reference_low: null, reference_high: 99 }), 'até 99');
    assert.equal(formatReference({ reference_low: null, reference_high: null }), null);
    assert.equal(formatDate('2026-10-15'), '15/10/2026');
    assert.equal(formatDate(null), 'Sem data');
    assert.equal(formatExamContext({ exam_type: 'ogtt75g', timepoint: '1h' }), 'TOTG 75 g, 1 h');
    assert.equal(formatExamContext({ exam_type: null, timepoint: null }), null);
  });

  it('lê a data digitada no formato brasileiro e recusa data impossível', () => {
    assert.equal(parseDateInput('15/10/2026'), '2026-10-15');
    assert.equal(parseDateInput('2026-10-15'), '2026-10-15');
    assert.equal(parseDateInput('31/02/2026'), null);
    assert.equal(parseDateInput('ontem'), null);
  });

  it('pendente pode ser aceito, corrigido ou rejeitado; decidido só reabre', () => {
    assert.deepEqual(availableActions('pending'), ['accept', 'correct', 'reject']);
    assert.deepEqual(availableActions('accepted'), ['reopen']);
    assert.deepEqual(availableActions('rejected'), ['reopen']);
  });
});

describe('revisão dos analitos: corpo de cada ação', () => {
  it('aceitar manda só a versão', () => {
    assert.deepEqual(buildReviewBody('accept', result()), { body: { version: 1 } });
  });

  it('glicemia sem tipo pede o tipo; TOTG pede o tempo', () => {
    assert.deepEqual(buildReviewBody('accept', glucose()), { error: 'Escolha o tipo do exame de glicemia.' });
    assert.deepEqual(buildReviewBody('accept', glucose(), { examType: 'ogtt75g' }), { error: 'Escolha o tempo do TOTG.' });
    assert.deepEqual(
      buildReviewBody('accept', glucose(), { examType: 'ogtt75g', timepoint: '2h' }),
      { body: { version: 1, exam_type: 'ogtt75g', timepoint: '2h' } }
    );
    assert.deepEqual(
      buildReviewBody('accept', glucose({ exam_type: 'fasting' })),
      { body: { version: 1, exam_type: 'fasting' } }
    );
  });

  it('rejeitar e reabrir exigem justificativa', () => {
    assert.deepEqual(buildReviewBody('reject', result(), { reason: '  ' }), { error: 'Escreva a justificativa.' });
    assert.deepEqual(
      buildReviewBody('reopen', result({ status: 'accepted', version: 2 }), { reason: 'Conferir unidade' }),
      { body: { version: 2, reason: 'Conferir unidade' } }
    );
  });

  it('corrigir converte vírgula, data brasileira e mantém o tipo só na glicemia', () => {
    const form = { ...correctionFormFrom(result()), value: '9,8' };
    assert.equal(form.observed_at, '15/10/2026');
    assert.deepEqual(buildReviewBody('correct', result(), { reason: 'OCR', form }), {
      body: {
        version: 1,
        reason: 'OCR',
        value: 9.8,
        unit: 'g/dL',
        reference_low: 11,
        reference_high: 15,
        observed_at: '2026-10-15',
        exam_type: null,
        timepoint: null,
      },
    });
  });

  it('corrigir aponta os campos que faltam', () => {
    const form = { ...correctionFormFrom(glucose()), unit: '', observed_at: '99/99/2026' };
    assert.deepEqual(
      buildReviewBody('correct', glucose(), { reason: 'x', form }),
      { error: 'Confira: data da coleta, unidade, tipo do exame.' }
    );
  });
});

describe('revisão dos analitos: erros da API', () => {
  it('explica o que falta, conflito de versão e acesso negado', () => {
    assert.equal(
      getLabReviewErrorMessage(apiError(422, { code: 'LAB_RESULT_INCOMPLETE', missing: ['exam_type'] })),
      'Faltam dados: tipo do exame. Use Corrigir para completar.'
    );
    assert.match(getLabReviewErrorMessage(apiError(409, { code: 'LAB_RESULT_VERSION_CONFLICT' })), /mudou/);
    assert.match(getLabReviewErrorMessage(apiError(403, { error: 'Médico não vinculado' })), /médico vinculado/);
    assert.match(getLabReviewErrorMessage({ message: 'Network Error' }), /Sem conexão/);
    assert.equal(getLabReviewErrorMessage(apiError(500, { error: 'internal_error' })), LAB_REVIEW_GENERIC_ERROR);
  });

  it('recarrega a lista só em conflito', () => {
    assert.equal(shouldReloadAfterError(apiError(409, { code: 'LAB_RESULT_VERSION_CONFLICT' })), true);
    assert.equal(shouldReloadAfterError(apiError(409, { code: 'LAB_RESULT_INVALID_TRANSITION' })), true);
    assert.equal(shouldReloadAfterError(apiError(400, { code: 'LAB_RESULT_REASON_REQUIRED' })), false);
  });
});
