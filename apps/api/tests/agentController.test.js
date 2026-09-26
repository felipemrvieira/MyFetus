const test = require('node:test');
const assert = require('node:assert');
const Module = require('node:module');
const express = require('express');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = 'test-secret';

// Vinculos ativos medico -> gestante usados pelo mock do banco.
const ACTIVE_LINKS = [{ doctorId: 10, pregnantId: 1 }];

const clientMock = {
  query: test.mock.fn(async (sql, params) => {
    if (sql.includes('doctor_patient_links')) {
      const [doctorId, pregnantId] = params;
      const linked = ACTIVE_LINKS.some(
        (link) => link.doctorId === doctorId && link.pregnantId === pregnantId
      );
      return { rows: linked ? [{ '?column?': 1 }] : [] };
    }
    if (sql.includes('FROM pregnants')) {
      return { rows: [{ id: params[0], patient_name: 'Maria' }] };
    }
    return { rows: [] };
  }),
};
const generationServiceMock = {
  generateMaternalAgentAnalysis: test.mock.fn(async () => 'Análise simulada pelo agente'),
};

const mocks = {
  '../backend': clientMock,
  '../services/clinicalDataService': {
    decryptPregnantDetails: () => ({ id: 1, name: 'Maria' }),
  },
  '../utils/ragRetrieval': {
    semanticSearch: async () => ({
      resultados: [{ fonte: 'FEBRASGO', trecho: 'Diretriz de teste' }],
    }),
  },
  '../services/generationService': generationServiceMock,
  '../services/embeddingService': { generateEmbedding: async () => [0.1] },
  '../services/vectorStoreService': {
    queryVectors: async () => ({
      matches: [{ id: 'c1', metadata: { text: 'Diretriz' }, values: [0.1] }],
    }),
  },
};

const originalRequire = Module.prototype.require;
Module.prototype.require = function (request) {
  if (Object.prototype.hasOwnProperty.call(mocks, request)) return mocks[request];
  return originalRequire.apply(this, arguments);
};

const agentRoutes = require('../routes/agent');

function tokenFor(user) {
  return `Bearer ${jwt.sign(user, process.env.JWT_SECRET)}`;
}

test.describe('POST /api/agent/maternal-analysis - autorizacao', () => {
  let server;
  let baseUrl;

  test.before(async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/agent', agentRoutes);
    await new Promise((resolve) => {
      server = app.listen(0, resolve);
    });
    baseUrl = `http://127.0.0.1:${server.address().port}/api/agent/maternal-analysis`;
  });

  test.after(() => {
    Module.prototype.require = originalRequire;
    server.close();
  });

  test.beforeEach(() => {
    generationServiceMock.generateMaternalAgentAnalysis.mock.resetCalls();
  });

  async function post(body, authorization) {
    const headers = { 'Content-Type': 'application/json' };
    if (authorization) headers.Authorization = authorization;
    return fetch(baseUrl, { method: 'POST', headers, body: JSON.stringify(body) });
  }

  test('retorna 401 sem token', async () => {
    const res = await post({ patientId: 1, query: 'pressao alta' });
    assert.strictEqual(res.status, 401);
  });

  test('retorna 403 para gestante, mesmo sendo dona do registro', async () => {
    const res = await post(
      { patientId: 1, query: 'pressao alta' },
      tokenFor({ id: 5, role: 'gestante' })
    );
    assert.strictEqual(res.status, 403);
    assert.strictEqual(generationServiceMock.generateMaternalAgentAnalysis.mock.callCount(), 0);
  });

  test('retorna 403 para medico sem vinculo ativo com a gestante (IDOR)', async () => {
    const res = await post(
      { patientId: 2, query: 'pressao alta' },
      tokenFor({ id: 10, role: 'medico' })
    );
    assert.strictEqual(res.status, 403);
    assert.strictEqual(generationServiceMock.generateMaternalAgentAnalysis.mock.callCount(), 0);
  });

  test('retorna 400 para patientId invalido', async () => {
    const res = await post(
      { patientId: '1 OR 1=1', query: 'pressao alta' },
      tokenFor({ id: 10, role: 'medico' })
    );
    assert.strictEqual(res.status, 400);
  });

  test('permite medico vinculado a gestante', async () => {
    const res = await post(
      { patientId: 1, query: 'pressao alta' },
      tokenFor({ id: 10, role: 'medico' })
    );
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.analysis, 'Análise simulada pelo agente');
  });

  test('permite admin acessar qualquer gestante', async () => {
    const res = await post(
      { patientId: 2, query: 'pressao alta' },
      tokenFor({ id: 1, role: 'admin' })
    );
    assert.strictEqual(res.status, 200);
  });
});
