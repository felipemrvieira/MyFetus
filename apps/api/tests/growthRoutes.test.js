const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = 'test-secret';

const growthRoutes = require('../routes/growth');

test.describe('/api/growth/* - autenticacao JWT', () => {
  let server;
  let baseUrl;
  const validToken = `Bearer ${jwt.sign({ id: 5, role: 'gestante' }, process.env.JWT_SECRET)}`;

  test.before(async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/growth', growthRoutes);
    await new Promise((resolve) => {
      server = app.listen(0, resolve);
    });
    baseUrl = `http://127.0.0.1:${server.address().port}/api/growth`;
  });

  test.after(() => server.close());

  test('GET /chart retorna 401 sem token', async () => {
    const res = await fetch(`${baseUrl}/chart`);
    assert.strictEqual(res.status, 401);
  });

  test('POST /percentile retorna 401 sem token', async () => {
    const res = await fetch(`${baseUrl}/percentile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.strictEqual(res.status, 401);
  });

  test('GET /chart retorna 401 com token invalido', async () => {
    const res = await fetch(`${baseUrl}/chart`, {
      headers: { Authorization: 'Bearer token-falso' },
    });
    assert.strictEqual(res.status, 401);
  });

  test('GET /chart responde normalmente com JWT valido', async () => {
    const res = await fetch(`${baseUrl}/chart`, {
      headers: { Authorization: validToken },
    });
    assert.notStrictEqual(res.status, 401);
    assert.notStrictEqual(res.status, 403);
  });
});
