const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DocumentReportConflictError,
  DocumentReportValidationError,
  createReport,
  listReports,
  publishReport,
  validateCreatePayload,
} = require('../services/documentReportService');

const crypto = {
  currentVersion: 1,
  encryptRecord(record) { return record; },
  decryptRecord(record) { return { ...record }; },
  getCurrentVersion() { return 1; },
};

function report(overrides = {}) {
  return {
    id: 11,
    document_id: 9,
    pregnant_id: 7,
    author_user_id: 3,
    version: 1,
    status: 'in_review',
    severity: 'attention',
    content: 'Acompanhamento necessário.',
    supersedes_report_id: null,
    published_at: null,
    created_at: '2026-11-16T12:00:00.000Z',
    updated_at: '2026-11-16T12:00:00.000Z',
    ...overrides,
  };
}

test('valida severidade e conteúdo da devolutiva', () => {
  assert.deepEqual(
    validateCreatePayload({ severity: 'normal', content: '  Orientação clínica.  ' }),
    { severity: 'normal', content: 'Orientação clínica.' }
  );
  const attention = validateCreatePayload({ severity: 'attention', content: 'Acompanhar.' });
  assert.match(attention.content, /Acompanhar\./);
  assert.match(attention.content, /Esta orientação não é diagnóstico nem prescrição\./);
  const urgent = validateCreatePayload({ severity: 'seek_care_today', content: 'Avaliação imediata.' });
  assert.match(urgent.content, /Seu exame precisa de avaliação hoje\. Procure a maternidade\./);
  assert.throws(
    () => validateCreatePayload({ severity: 'unknown', content: 'texto' }),
    DocumentReportValidationError
  );
  assert.throws(
    () => validateCreatePayload({ severity: 'normal', content: '   ' }),
    DocumentReportValidationError
  );
});

test('cria uma nova versão em revisão sem sobrescrever o histórico', async () => {
  const calls = [];
  const connection = {
    async query(text, values) {
      calls.push({ text, values });
      if (text === 'BEGIN' || text === 'COMMIT') return { rows: [] };
      if (text.includes('FROM pregnant_documents')) return { rows: [{ id: 9, pregnant_id: 7 }] };
      if (text.includes('MAX(version)')) return { rows: [{ next_version: 2 }] };
      if (text.includes("status = 'published'")) return { rows: [{ id: 10 }] };
      if (text.includes('INSERT INTO document_reports')) return { rows: [report({ id: 12, version: 2 })] };
      throw new Error(`Consulta não prevista: ${text}`);
    },
    release() {},
  };
  const result = await createReport(
    { connect: async () => connection },
    { documentId: 9, authorUserId: 3, payload: { severity: 'normal', content: 'Nova versão.' }, crypto }
  );
  assert.equal(result.version, 2);
  assert.equal(result.status, 'in_review');
  assert.equal(calls.at(-1).text, 'COMMIT');
  assert.equal(calls.find((call) => call.text.includes('INSERT INTO document_reports')).values[6], 10);
});

test('publica a versão e substitui a publicação anterior em transação', async () => {
  const calls = [];
  const connection = {
    async query(text, values) {
      calls.push({ text, values });
      if (text === 'BEGIN' || text === 'COMMIT') return { rows: [] };
      if (text.includes('FOR UPDATE')) return { rows: [report({ id: 12, status: 'in_review', version: 2 })] };
      if (text.includes("SET status = 'replaced'")) return { rows: [] };
      if (text.includes("SET status = 'published'")) return { rows: [report({ id: 12, status: 'published', version: 2, published_at: '2026-11-16T12:05:00.000Z' })] };
      throw new Error(`Consulta não prevista: ${text}`);
    },
    release() {},
  };
  const result = await publishReport({ connect: async () => connection }, { reportId: 12, crypto });
  assert.equal(result.status, 'published');
  assert.equal(calls.filter((call) => call.text === 'COMMIT').length, 1);
  assert.ok(calls.some((call) => call.text.includes("SET status = 'replaced'")));
});

test('impede republicar uma versão já publicada', async () => {
  const connection = {
    async query(text) {
      if (text === 'BEGIN') return { rows: [] };
      if (text.includes('FOR UPDATE')) return { rows: [report({ status: 'published' })] };
      if (text === 'ROLLBACK') return { rows: [] };
      throw new Error(`Consulta não prevista: ${text}`);
    },
    release() {},
  };
  await assert.rejects(
    () => publishReport({ connect: async () => connection }, { reportId: 11, crypto }),
    DocumentReportConflictError
  );
});

test('gestante recebe somente a última devolutiva publicada', async () => {
  let queryText = '';
  const result = await listReports(
    { query: async (text) => { queryText = text; return { rows: [report({ status: 'published' })] }; } },
    { documentId: 9, role: 'gestante', crypto }
  );
  assert.equal(result.length, 1);
  assert.match(queryText, /status = 'published'/);
  assert.match(queryText, /LIMIT 1/);
});
