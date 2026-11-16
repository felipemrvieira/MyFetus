const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ConsultationConflictError,
  ConsultationNotFoundError,
  ConsultationValidationError,
  createAddendum,
  createConsultation,
  finalizeConsultation,
  listConsultations,
  validateAddendumPayload,
  validateCreatePayload,
} = require('../services/consultationService');

const crypto = {
  currentVersion: 1,
  encryptRecord(record) { return record; },
  decryptRecord(record) { return { ...record }; },
};

function consultation(overrides = {}) {
  return {
    id: 10,
    pregnancy_id: 7,
    author_user_id: 3,
    parent_consultation_id: null,
    version: 1,
    status: 'draft',
    consultation_at: '2026-11-16T14:00:00.000Z',
    gestational_age_weeks: 24,
    evolution: 'Evolução sintética.',
    conduct: 'Conduta sintética.',
    prescription_text: null,
    next_return_at: '2026-11-30',
    finalized_at: null,
    ...overrides,
  };
}

test('valida o contrato de criação e mantém a prescrição textual opcional', () => {
  const payload = validateCreatePayload({
    consultation_at: '2026-11-16T14:00:00-03:00',
    gestational_age_weeks: 24,
    evolution: ' Evolução sintética. ',
    conduct: ' Conduta sintética. ',
    next_return_at: '2026-11-30',
  });
  assert.equal(payload.consultation_at, '2026-11-16T17:00:00.000Z');
  assert.equal(payload.evolution, 'Evolução sintética.');
  assert.equal(payload.prescription_text, null);
  assert.throws(
    () => validateCreatePayload({
      consultation_at: '2026-11-16',
      evolution: 'ok',
    }),
    ConsultationValidationError
  );
  assert.throws(
    () => validateAddendumPayload({}),
    ConsultationValidationError
  );
});

test('cria consulta com vínculo de gestação, autor e campos clínicos', async () => {
  const calls = [];
  const db = {
    async query(text, values) {
      calls.push({ text, values });
      return { rows: [consultation({
        pregnancy_id: values[0],
        author_user_id: values[1],
        evolution: values[4],
        conduct: values[5],
        prescription_text: values[6],
      })] };
    },
  };
  const result = await createConsultation(db, 7, {
    consultation_at: '2026-11-16T14:00:00Z',
    gestational_age_weeks: 24,
    evolution: 'Evolução sintética.',
    conduct: 'Conduta sintética.',
    prescription_text: 'Prescrição textual sintética.',
    next_return_at: '2026-11-30',
  }, 3, { crypto });
  assert.equal(result.pregnancy_id, 7);
  assert.equal(result.author_user_id, 3);
  assert.match(calls[0].text, /INSERT INTO consultations/);
  assert.equal(calls[0].values[7], '2026-11-30');
});

test('lista por data e cria adendo sem apagar o original', async () => {
  const calls = [];
  const db = {
    async query(text, values) {
      calls.push({ text, values });
      if (text.includes('WHERE id = $1')) return { rows: [consultation()] };
      return { rows: [consultation()] };
    },
  };
  const listed = await listConsultations(db, 7, { limit: '20' }, { crypto });
  assert.equal(listed.length, 1);
  const addendum = await createAddendum(db, 10, {
    conduct: 'Conduta corrigida sintética.',
  }, 3, { crypto });
  assert.equal(addendum.pregnancy_id, 7);
  assert.match(calls[2].text, /INSERT INTO consultations/);
  assert.equal(calls[2].values[2], 10);
  assert.equal(calls[2].values[3], 2);
  assert.throws(() => validateAddendumPayload({ conduct: '   ' }), ConsultationValidationError);
});

test('finalização é explícita e segunda finalização exige adendo', async () => {
  const db = {
    calls: 0,
    async query(text) {
      this.calls += 1;
      if (text.includes('SELECT *')) return { rows: [consultation()] };
      return { rows: [consultation({ status: 'finalized', finalized_at: '2026-11-16T14:01:00Z' })] };
    },
  };
  const result = await finalizeConsultation(db, 10, { crypto });
  assert.equal(result.status, 'finalized');

  const finalizedDb = {
    async query(text) {
      if (text.includes('SELECT *')) return { rows: [consultation({ status: 'finalized', finalized_at: '2026-11-16T14:01:00Z' })] };
      return { rows: [] };
    },
  };
  await assert.rejects(
    () => finalizeConsultation(finalizedDb, 10, { crypto }),
    ConsultationConflictError
  );
  await assert.rejects(
    () => createAddendum({ query: async () => ({ rows: [] }) }, 99, {}, 3, { crypto }),
    ConsultationNotFoundError
  );
});
