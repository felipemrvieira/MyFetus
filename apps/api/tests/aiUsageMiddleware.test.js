const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const { createAiUsageMiddleware } = require('../middlewares/aiUsage');
const { createAiUsageStore, getAiUsageConfig } = require('../services/aiUsageService');

test('middleware cacheia por usuário e bloqueia a cota sem cruzar usuários', async () => {
  const store = createAiUsageStore({
    config: getAiUsageConfig({ AI_CACHE_TTL_MS: '60000', AI_DAILY_QUOTA: '2' }),
  });
  const app = express();
  app.use(express.json());
  let calls = 0;
  app.post('/ai', (req, _res, next) => {
    req.user = { id: Number(req.headers['x-user-id']), role: 'gestante' };
    next();
  }, createAiUsageMiddleware({ operation: 'chat', store }), (_req, res) => {
    calls += 1;
    res.json({ answer: `provider-${calls}` });
  });
  const server = await new Promise(resolve => {
    const instance = app.listen(0, () => resolve(instance));
  });
  const url = `http://127.0.0.1:${server.address().port}/ai`;

  try {
    const first = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-user-id': '1' }, body: JSON.stringify({ query: 'x' }) });
    const second = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-user-id': '1' }, body: JSON.stringify({ query: 'x' }) });
    const otherUser = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-user-id': '2' }, body: JSON.stringify({ query: 'x' }) });
    const third = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-user-id': '1' }, body: JSON.stringify({ query: 'different' }) });

    assert.equal(first.status, 200);
    assert.equal(first.headers.get('x-ai-cache'), 'MISS');
    assert.equal(second.headers.get('x-ai-cache'), 'HIT');
    assert.equal(otherUser.headers.get('x-ai-cache'), 'MISS');
    assert.equal(third.status, 429);
    assert.equal(calls, 2);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('middleware não cacheia contexto de paciente por padrão', async () => {
  const store = createAiUsageStore({
    config: getAiUsageConfig({ AI_CACHE_TTL_MS: '60000' }),
  });
  const app = express();
  app.use(express.json());
  let calls = 0;
  app.post('/agents', (req, _res, next) => {
    req.user = { id: 1, role: 'medico' };
    next();
  }, createAiUsageMiddleware({ operation: 'agents', store }), (_req, res) => {
    calls += 1;
    res.json({ answer: calls });
  });
  const server = await new Promise(resolve => {
    const instance = app.listen(0, () => resolve(instance));
  });
  const url = `http://127.0.0.1:${server.address().port}/agents`;

  try {
    const headers = { 'content-type': 'application/json' };
    const body = JSON.stringify({ patient_id: 42, query: 'x' });
    const first = await fetch(url, { method: 'POST', headers, body });
    const second = await fetch(url, { method: 'POST', headers, body });
    assert.equal(first.headers.get('x-ai-cache'), 'DISABLED');
    assert.equal(second.headers.get('x-ai-cache'), 'DISABLED');
    assert.equal(calls, 2);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
