const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const Module = require('node:module');
const express = require('express');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = 'lab-results-test-secret';
process.env.AES_KEY_VERSION = '1';
process.env.AES_ENCRYPTION_KEY_V1 = crypto.randomBytes(32).toString('hex');

const cryptoService = require('../services/cryptoService');
const {
  LabResultError,
  planReview,
  rowsFromParse,
} = require('../services/labResultService');
const { parseExamText } = require('../services/labResultParser');

const EXAM_TEXT = [
  'Data do exame: 15/10/2026',
  'Hemoglobina: 10,2 g/dL referência 11 a 15',
  'Glicemia de jejum: 98 mg/dL',
  'Glicose: 110 mg/dL',
  'Glicemia TOTG 75 g 1 h: 185 mg/dL',
  'Proteína urinária: 350 mg/24h',
].join('\n');

const OTHER_TEXT = 'Data do exame: 01/10/2026\nHemoglobina: 12,8 g/dL';

const clone = (value) => structuredClone(value);
const enc = (record, table) => cryptoService.encryptRecord(record, table);

// ------------------------------------------------------------ regras puras
function pendingRow(overrides = {}) {
  return {
    id: 1,
    pregnant_id: 10,
    analyte_id: 'hemoglobin',
    status: 'pending',
    version: 1,
    value: 10.2,
    unit: 'g/dL',
    reference_low: 11,
    reference_high: 15,
    observed_at: '2026-10-15',
    exam_type: null,
    timepoint: null,
    ...overrides,
  };
}

function expectLabError(fn, code) {
  assert.throws(fn, (error) => error instanceof LabResultError && error.code === code);
}

test.describe('Estruturação do texto extraído', () => {
  test('cada analito vira uma linha pendente, com o tipo da glicemia só quando está escrito', () => {
    const rows = rowsFromParse(parseExamText(EXAM_TEXT), { documentId: 900, pregnantId: 10 });
    const byLine = rows.map((row) => [row.analyte_id, row.exam_type, row.timepoint]);
    assert.deepEqual(byLine, [
      ['hemoglobin', null, null],
      ['glucose', 'fasting', null],
      ['glucose', null, null],
      ['glucose', 'ogtt75g', '1h'],
      ['urine_protein', null, null],
    ]);
    const hb = rows[0];
    assert.equal(hb.original_value, 10.2);
    assert.equal(hb.value, 10.2);
    assert.equal(hb.unit, 'g/dL');
    assert.equal(hb.observed_at, '2026-10-15');
    assert.equal(hb.line_index, 0);
    assert.equal('status' in hb, false, 'o status nasce pendente pelo banco');
  });
});

test.describe('Regras da revisão (planReview)', () => {
  test('aceitar um valor completo gera a versão 2 com status accepted', () => {
    const plan = planReview(pendingRow(), { action: 'accept', expectedVersion: 1 });
    assert.equal(plan.status, 'accepted');
    assert.equal(plan.version, 2);
    assert.equal(plan.reason, null);
    assert.equal(plan.values.value, 10.2);
  });

  test('glicemia sem o tipo não é aceita; com o tipo no corpo, é', () => {
    const glucose = pendingRow({ analyte_id: 'glucose', value: 110, unit: 'mg/dL' });
    assert.throws(
      () => planReview(glucose, { action: 'accept', expectedVersion: 1 }),
      (error) => error.code === 'LAB_RESULT_INCOMPLETE' && error.status === 422 && error.details.missing.includes('exam_type')
    );
    const plan = planReview(glucose, { action: 'accept', expectedVersion: 1, payload: { exam_type: 'casual' } });
    assert.equal(plan.values.exam_type, 'casual');
  });

  test('TOTG exige o tempo da coleta', () => {
    const ogtt = pendingRow({ analyte_id: 'glucose', value: 185, unit: 'mg/dL', exam_type: 'ogtt75g' });
    assert.throws(
      () => planReview(ogtt, { action: 'accept', expectedVersion: 1 }),
      (error) => error.code === 'LAB_RESULT_INCOMPLETE' && error.details.missing.includes('timepoint')
    );
    const plan = planReview(ogtt, { action: 'accept', expectedVersion: 1, payload: { timepoint: '2h' } });
    assert.equal(plan.values.timepoint, '2h');
  });

  test('valor numérico sem unidade ou sem data não é aceito', () => {
    assert.throws(
      () => planReview(pendingRow({ unit: null, observed_at: null }), { action: 'accept', expectedVersion: 1 }),
      (error) => error.code === 'LAB_RESULT_INCOMPLETE' && error.details.missing.join() === 'unit,observed_at'
    );
  });

  test('corrigir exige justificativa e guarda os valores novos', () => {
    expectLabError(
      () => planReview(pendingRow(), { action: 'correct', expectedVersion: 1, payload: { value: 9.8 } }),
      'LAB_RESULT_REASON_REQUIRED'
    );
    const plan = planReview(pendingRow({ unit: null }), {
      action: 'correct',
      expectedVersion: 1,
      payload: { value: '9,8', unit: 'g/dL', reason: 'OCR trocou o dígito' },
    });
    assert.equal(plan.status, 'corrected');
    assert.equal(plan.values.value, 9.8);
    assert.equal(plan.values.unit, 'g/dL');
    assert.equal(plan.reason, 'OCR trocou o dígito');
  });

  test('campos com formato inválido respondem 400', () => {
    assert.throws(
      () => planReview(pendingRow(), {
        action: 'correct',
        expectedVersion: 1,
        payload: { observed_at: '31/02/2026', exam_type: 'aleatorio', reason: 'x' },
      }),
      (error) => error.code === 'LAB_RESULT_INVALID_FIELDS' && error.status === 400
        && error.details.fields.includes('observed_at') && error.details.fields.includes('exam_type')
    );
  });

  test('rejeitar exige justificativa', () => {
    expectLabError(() => planReview(pendingRow(), { action: 'reject', expectedVersion: 1 }), 'LAB_RESULT_REASON_REQUIRED');
    assert.equal(
      planReview(pendingRow(), { action: 'reject', expectedVersion: 1, payload: { reason: 'Exame de outra paciente' } }).status,
      'rejected'
    );
  });

  test('reabrir só vale para decisão tomada e exige justificativa', () => {
    expectLabError(
      () => planReview(pendingRow(), { action: 'reopen', expectedVersion: 1, payload: { reason: 'x' } }),
      'LAB_RESULT_INVALID_TRANSITION'
    );
    const accepted = pendingRow({ status: 'accepted', version: 2 });
    expectLabError(() => planReview(accepted, { action: 'reopen', expectedVersion: 2 }), 'LAB_RESULT_REASON_REQUIRED');
    const plan = planReview(accepted, { action: 'reopen', expectedVersion: 2, payload: { reason: 'Revisar unidade' } });
    assert.equal(plan.status, 'pending');
    assert.equal(plan.version, 3);
  });

  test('decisão já tomada não aceita outra ação sem reabrir', () => {
    expectLabError(
      () => planReview(pendingRow({ status: 'rejected', version: 2 }), { action: 'accept', expectedVersion: 2 }),
      'LAB_RESULT_INVALID_TRANSITION'
    );
  });

  test('versão ausente ou desatualizada bloqueia a decisão', () => {
    expectLabError(() => planReview(pendingRow(), { action: 'accept' }), 'LAB_RESULT_VERSION_REQUIRED');
    expectLabError(() => planReview(pendingRow({ version: 3 }), { action: 'accept', expectedVersion: 2 }), 'LAB_RESULT_VERSION_CONFLICT');
  });
});

// ------------------------------------------------------------ banco sintético
function seed() {
  return {
    links: [{ doctor_id: 3, pregnant_id: 10, status: 'active' }],
    documents: [
      { id: 900, pregnant_id: 10, document_name: 'Hemograma', extraction_status: 'done', extracted_text: EXAM_TEXT },
      { id: 901, pregnant_id: 20, document_name: 'Exame de outra', extraction_status: 'done', extracted_text: OTHER_TEXT },
      { id: 902, pregnant_id: 10, document_name: 'Em processamento', extraction_status: 'processing', extracted_text: null },
    ].map((document) => ({
      ...document,
      ...enc({ document_name: document.document_name, extracted_text: document.extracted_text }, 'pregnant_documents'),
      uploaded_at: '2026-10-15T12:00:00.000Z',
      extracted_at: null,
    })),
    lab_results: [],
    lab_result_reviews: [],
  };
}

const LAB_COLUMNS_ORDER = [
  'document_id', 'pregnant_id', 'line_index', 'analyte_id', 'loinc', 'raw_text',
  'original_value', 'original_unit', 'original_reference_low', 'original_reference_high',
  'original_observed_at', 'original_exam_type', 'original_timepoint', 'confidence',
  'ambiguity_reason', 'parser_version', 'extraction_method', 'value', 'unit',
  'reference_low', 'reference_high', 'observed_at', 'exam_type', 'timepoint',
  'encryption_key_version',
];

const db = {
  tables: null,
  snapshot: null,
  nextId: 1,
  failOn: null,
  reset() {
    this.tables = seed();
    this.snapshot = null;
    this.nextId = 1;
    this.failOn = null;
  },
  async query(sql, params = []) {
    const text = sql.replace(/\s+/g, ' ').trim();
    if (this.failOn && text.includes(this.failOn)) throw new Error('falha simulada');
    const t = this.tables;

    if (text === 'BEGIN') { this.snapshot = clone(this.tables); return { rows: [] }; }
    if (text === 'COMMIT') { this.snapshot = null; return { rows: [] }; }
    if (text === 'ROLLBACK') {
      if (this.snapshot) this.tables = this.snapshot;
      this.snapshot = null;
      return { rows: [] };
    }
    if (text.startsWith('SELECT approval_status')) return { rows: [{ approval_status: 'approved' }] };
    if (text.includes('FROM doctor_patient_links')) {
      const [doctorId, pregnantId] = params;
      return { rows: t.links.filter((l) => l.doctor_id === doctorId && l.pregnant_id === Number(pregnantId) && l.status === 'active') };
    }
    if (text.startsWith('SELECT id, pregnant_id, document_name, extraction_status')) {
      return { rows: t.documents.filter((d) => d.id === params[0]).map(clone) };
    }
    if (text.startsWith('SELECT COUNT(*)::int AS total FROM lab_results')) {
      return { rows: [{ total: t.lab_results.filter((r) => r.document_id === params[0]).length }] };
    }
    if (text.startsWith('INSERT INTO lab_results')) {
      const row = Object.fromEntries(LAB_COLUMNS_ORDER.map((column, index) => [column, params[index]]));
      if (t.lab_results.some((r) => r.document_id === row.document_id && r.line_index === row.line_index)) return { rows: [] };
      const id = this.nextId++;
      t.lab_results.push({ id, ...row, status: 'pending', version: 1, review_reason: null, reviewed_by_user_id: null, reviewed_at: null });
      return { rows: [{ id }] };
    }
    if (text === 'SELECT * FROM lab_results WHERE document_id = $1 ORDER BY line_index ASC') {
      return { rows: t.lab_results.filter((r) => r.document_id === params[0]).sort((a, b) => a.line_index - b.line_index).map(clone) };
    }
    if (text === 'SELECT id, pregnant_id, document_id FROM lab_results WHERE id = $1') {
      return { rows: t.lab_results.filter((r) => r.id === params[0]).map(({ id, pregnant_id, document_id }) => ({ id, pregnant_id, document_id })) };
    }
    if (text === 'SELECT * FROM lab_results WHERE id = $1 FOR UPDATE') {
      return { rows: t.lab_results.filter((r) => r.id === params[0]).map(clone) };
    }
    if (text.startsWith('UPDATE lab_results SET status = $1')) {
      const row = t.lab_results.find((r) => r.id === params[12] && r.version === params[13]);
      if (!row) return { rows: [] };
      Object.assign(row, {
        status: params[0], version: params[1], value: params[2], unit: params[3], reference_low: params[4],
        reference_high: params[5], observed_at: params[6], exam_type: params[7], timepoint: params[8],
        review_reason: params[9], reviewed_by_user_id: params[10], reviewed_at: '2026-10-31T12:00:00.000Z',
        encryption_key_version: params[11],
      });
      return { rows: [clone(row)] };
    }
    if (text.startsWith('INSERT INTO lab_result_reviews')) {
      const [labResultId, pregnantId, version, action, previousStatus, newStatus, snapshot, reason, userId, keyVersion] = params;
      if (t.lab_result_reviews.some((r) => r.lab_result_id === labResultId && r.version === version)) {
        throw new Error('violação de unicidade');
      }
      t.lab_result_reviews.push({
        lab_result_id: labResultId, pregnant_id: pregnantId, version, action,
        previous_status: previousStatus, new_status: newStatus, snapshot, reason,
        reviewed_by_user_id: userId, encryption_key_version: keyVersion, created_at: '2026-10-31T12:00:00.000Z',
      });
      return { rows: [] };
    }
    if (text.startsWith('SELECT * FROM lab_result_reviews')) {
      return { rows: t.lab_result_reviews.filter((r) => r.lab_result_id === params[0]).sort((a, b) => a.version - b.version).map(clone) };
    }
    throw new Error(`SQL inesperado no teste: ${text}`);
  },
};

const auditEvents = [];
const mocks = {
  '../backend': {
    query: (...args) => db.query(...args),
    connect: async () => ({ query: (...args) => db.query(...args), release() {} }),
  },
  '../services/auditService': { audit: (req, event) => auditEvents.push(event) },
  '../utils/logger': { error() {}, warn() {}, info() {}, request() {} },
};

const originalLoad = Module._load;
Module._load = function (request) {
  if (Object.prototype.hasOwnProperty.call(mocks, request)) return mocks[request];
  return originalLoad.apply(this, arguments);
};
// O mock fica ativo até o fim: o gate de aprovação do médico carrega o banco sob demanda.
const labResultsRoutes = require('../routes/labResults');

const tokenFor = (user) => `Bearer ${jwt.sign(user, process.env.JWT_SECRET)}`;
const MEDICA = tokenFor({ id: 3, role: 'medico' });
const OUTRO_MEDICO = tokenFor({ id: 5, role: 'medico' });
const ADMIN = tokenFor({ id: 4, role: 'admin' });
const GESTANTE = tokenFor({ id: 1, role: 'gestante' });

test.describe('API de revisão médica dos analitos (E2-04)', () => {
  let server;
  let baseUrl;

  async function call(method, path, token, body) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: token } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, body: await response.json() };
  }

  async function openDocument(documentId = 900) {
    return call('GET', `/documents/${documentId}`, MEDICA);
  }

  test.before(async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/lab-results', labResultsRoutes);
    await new Promise((resolve) => {
      server = app.listen(0, resolve);
    });
    baseUrl = `http://127.0.0.1:${server.address().port}/api/lab-results`;
  });

  test.after(() => {
    server.close();
    Module._load = originalLoad;
  });

  test.beforeEach(() => {
    db.reset();
    auditEvents.length = 0;
  });

  test('o médico vinculado abre o documento e os analitos aparecem pendentes, cifrados no banco', async () => {
    const { status, body } = await openDocument();
    assert.equal(status, 200);
    assert.equal(body.document.document_name, 'Hemograma');
    assert.deepEqual(body.summary, { total: 5, pending: 5, accepted: 0, corrected: 0, rejected: 0 });
    const hb = body.results[0];
    assert.equal(hb.analyte, 'Hemoglobina');
    assert.equal(hb.original.value, 10.2);
    assert.equal(hb.current.unit, 'g/dL');
    assert.match(hb.raw_text, /Hemoglobina/);
    assert.equal(hb.clinically_usable, false);
    assert.deepEqual(body.results[2].missing_for_acceptance, ['exam_type'], 'glicemia sem tipo pede o tipo');

    const stored = db.tables.lab_results[0];
    for (const field of ['raw_text', 'original_value', 'value', 'unit', 'observed_at']) {
      assert.ok(cryptoService.isEncrypted(stored[field]), `${field} deveria estar cifrado`);
    }

    await openDocument();
    assert.equal(db.tables.lab_results.length, 5, 'abrir de novo não duplica as linhas');
  });

  test('documento ainda em extração não gera linhas', async () => {
    const { status, body } = await openDocument(902);
    assert.equal(status, 200);
    assert.equal(body.summary.total, 0);
  });

  test('médico sem vínculo, admin e gestante não acessam', async () => {
    assert.equal((await call('GET', '/documents/901', MEDICA)).status, 403, 'documento de outra gestante');
    assert.equal((await call('GET', '/documents/900', OUTRO_MEDICO)).status, 403);
    assert.equal((await call('GET', '/documents/900', ADMIN)).status, 403);
    assert.equal((await call('GET', '/documents/900', GESTANTE)).status, 403);
    assert.equal((await call('GET', '/documents/900')).status, 401);
    assert.equal(db.tables.lab_results.length, 0, 'nenhum acesso negado estrutura o documento');
  });

  test('aceitar grava a versão, o histórico e uma auditoria sem o valor', async () => {
    const { body: opened } = await openDocument();
    const hb = opened.results[0];
    const { status, body } = await call('POST', `/${hb.id}/accept`, MEDICA, { version: hb.version });
    assert.equal(status, 200);
    assert.equal(body.result.status, 'accepted');
    assert.equal(body.result.version, 2);
    assert.equal(body.result.clinically_usable, true);
    assert.equal(body.result.reviewed_by_user_id, 3);

    assert.equal(db.tables.lab_result_reviews.length, 1);
    assert.ok(cryptoService.isEncrypted(db.tables.lab_result_reviews[0].snapshot));
    assert.deepEqual(auditEvents, [{
      action: 'LAB_RESULT_ACCEPTED',
      resource: 'lab_results',
      resource_id: String(hb.id),
      detail: { analyte_id: 'hemoglobin', version: 2, previous_status: 'pending', new_status: 'accepted' },
    }]);
    assert.doesNotMatch(JSON.stringify(auditEvents), /10\.2|g\/dL/);
  });

  test('o mesmo clique duas vezes não grava duas decisões', async () => {
    const { body: opened } = await openDocument();
    const hb = opened.results[0];
    const first = await call('POST', `/${hb.id}/accept`, MEDICA, { version: 1 });
    const second = await call('POST', `/${hb.id}/accept`, MEDICA, { version: 1 });
    assert.equal(first.status, 200);
    assert.equal(second.status, 409);
    assert.equal(second.body.code, 'LAB_RESULT_VERSION_CONFLICT');
    assert.equal(db.tables.lab_result_reviews.length, 1);
  });

  test('corrigir mantém o original e reabrir cria nova versão com histórico', async () => {
    const { body: opened } = await openDocument();
    const hb = opened.results[0];
    const corrected = await call('POST', `/${hb.id}/correct`, MEDICA, {
      version: 1, value: 9.8, reason: 'Valor lido errado no PDF',
    });
    assert.equal(corrected.status, 200);
    assert.equal(corrected.body.result.status, 'corrected');
    assert.equal(corrected.body.result.current.value, 9.8);
    assert.equal(corrected.body.result.original.value, 10.2);

    const reopened = await call('POST', `/${hb.id}/reopen`, MEDICA, { version: 2, reason: 'Conferir com o laudo' });
    assert.equal(reopened.status, 200);
    assert.equal(reopened.body.result.status, 'pending');
    assert.equal(reopened.body.result.version, 3);

    const history = await call('GET', `/${hb.id}/history`, MEDICA);
    assert.equal(history.status, 200);
    assert.deepEqual(history.body.history.map((h) => [h.version, h.action, h.new_status]), [
      [2, 'correct', 'corrected'],
      [3, 'reopen', 'pending'],
    ]);
    assert.equal(history.body.history[0].values.value, 9.8);
    assert.equal(history.body.history[0].reason, 'Valor lido errado no PDF');
  });

  test('rejeitar sem justificativa e aceitar glicemia sem tipo são recusados', async () => {
    const { body: opened } = await openDocument();
    const [hb, , glucose] = opened.results;
    const rejected = await call('POST', `/${hb.id}/reject`, MEDICA, { version: 1 });
    assert.equal(rejected.status, 400);
    assert.equal(rejected.body.code, 'LAB_RESULT_REASON_REQUIRED');

    const accepted = await call('POST', `/${glucose.id}/accept`, MEDICA, { version: 1 });
    assert.equal(accepted.status, 422);
    assert.equal(accepted.body.code, 'LAB_RESULT_INCOMPLETE');
    assert.deepEqual(accepted.body.missing, ['exam_type']);
    assert.equal(db.tables.lab_result_reviews.length, 0);
    assert.equal(auditEvents.length, 0);
  });

  test('admin e médico sem vínculo não decidem', async () => {
    const { body: opened } = await openDocument();
    const hb = opened.results[0];
    assert.equal((await call('POST', `/${hb.id}/accept`, ADMIN, { version: 1 })).status, 403);
    assert.equal((await call('POST', `/${hb.id}/accept`, OUTRO_MEDICO, { version: 1 })).status, 403);
    assert.equal((await call('GET', `/${hb.id}/history`, OUTRO_MEDICO)).status, 403);
    assert.equal(db.tables.lab_results[0].status, 'pending');
  });

  test('falha no banco no meio da decisão desfaz tudo e responde erro genérico', async () => {
    const { body: opened } = await openDocument();
    const hb = opened.results[0];
    db.failOn = 'INSERT INTO lab_result_reviews';
    const { status, body } = await call('POST', `/${hb.id}/accept`, MEDICA, { version: 1 });
    assert.equal(status, 500);
    assert.deepEqual(body, { error: 'internal_error' });
    assert.equal(db.tables.lab_results[0].status, 'pending');
    assert.equal(db.tables.lab_results[0].version, 1);
  });

  test('ids inválidos e resultado inexistente', async () => {
    assert.equal((await call('GET', '/documents/abc', MEDICA)).status, 400);
    assert.equal((await call('GET', '/documents/999', MEDICA)).status, 404);
    assert.equal((await call('POST', '/999/accept', MEDICA, { version: 1 })).status, 404);
  });
});
