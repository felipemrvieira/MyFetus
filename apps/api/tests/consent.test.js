const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');

process.env.JWT_SECRET = 'consent-test-secret';

const { CONSENT_PURPOSES } = require('../config/consentPolicy');

const PURPOSE = 'termos_e_privacidade';
const CURRENT_VERSION = CONSENT_PURPOSES[PURPOSE].version;
const VALID_SIGNUP = {
  name: 'Maria Exemplo',
  email: 'maria.exemplo@example.com',
  password: 'senha-sintetica-123',
  birthdate: '1995-04-12',
  consents: [{ purpose: PURPOSE, version: CURRENT_VERSION }],
};

// ---------------------------------------------------------------- banco fake
// Simula transação: inserts após BEGIN só valem no COMMIT; ROLLBACK descarta.
const db = {
  users: [],
  consents: [],
  log: [],
  staged: null,
  failConsentInsert: false,
  failConsentRead: false,
  nextUserId: 100,
  nextConsentId: 1,
  reset() {
    this.users = [];
    this.consents = [];
    this.log = [];
    this.staged = null;
    this.failConsentInsert = false;
    this.failConsentRead = false;
  },
  table(name) {
    return this.staged ? this.staged[name] : this[name];
  },
  async query(sql, params = []) {
    const statement = sql.trim().split(/\s+/).slice(0, 3).join(' ');
    this.log.push(statement);

    if (sql === 'BEGIN') {
      this.staged = { users: [...this.users], consents: [...this.consents] };
      return { rows: [] };
    }
    if (sql === 'COMMIT') {
      Object.assign(this, { users: this.staged.users, consents: this.staged.consents, staged: null });
      return { rows: [] };
    }
    if (sql === 'ROLLBACK') {
      this.staged = null;
      return { rows: [] };
    }
    if (/INSERT INTO users/.test(sql)) {
      const row = { id: this.nextUserId++, name: params[0], email: params[1], password: params[2], birthdate: params[3], is_active: params[4], role: params[5], email_lookup_hash: params[6] };
      this.table('users').push(row);
      return { rows: [row] };
    }
    if (/INSERT INTO pregnants/.test(sql)) return { rows: [] };
    if (/INSERT INTO consents/.test(sql)) {
      if (this.failConsentInsert) throw new Error('falha simulada ao gravar consentimento');
      const [userId, purpose, version, decision, ipAddress, userAgent] = params;
      const row = { id: this.nextConsentId++, user_id: userId, purpose, version, decision, ip_address: ipAddress, user_agent: userAgent, created_at: new Date() };
      this.table('consents').push(row);
      return { rows: [row] };
    }
    if (/FROM consents/.test(sql)) {
      if (this.failConsentRead) throw new Error('relation "consents" does not exist');
      const latest = new Map();
      for (const row of this.table('consents').filter((item) => item.user_id === params[0])) {
        latest.set(row.purpose, row);
      }
      return { rows: [...latest.values()] };
    }
    if (/WHERE u\.email_lookup_hash = \$1/.test(sql)) {
      const user = this.users.find((item) => item.email_lookup_hash === params[0]);
      return { rows: user ? [{ ...user, pregnant_id: 1 }] : [] };
    }
    return { rows: [] };
  },
};

const auditEvents = [];
const mocks = {
  '../backend': {
    query: (...args) => db.query(...args),
    connect: async () => ({ query: (...args) => db.query(...args), release() {} }),
  },
  '../services/cryptoService': {
    encryptRecord: (record) => record,
    decryptRecord: (record) => record,
    getCurrentVersion: () => 1,
  },
  '../services/emailLookupService': {
    hashEmail: (email) => `hash:${email}`,
    normalizeEmail: (email) => String(email).trim().toLowerCase(),
  },
  '../services/auditService': {
    audit: (req, event) => auditEvents.push(event),
    buildAuditEntry: () => ({ ip_address: '203.0.113.10', user_agent: 'teste-sintetico' }),
  },
  '../utils/logger': { error() {}, warn() {}, info() {}, request() {} },
};

const originalLoad = Module._load;
Module._load = function (request) {
  if (Object.prototype.hasOwnProperty.call(mocks, request)) return mocks[request];
  return originalLoad.apply(this, arguments);
};
const userRoutes = require('../routes/users');
const consentRoutes = require('../routes/consents');
const { getConsentStatus } = require('../services/consentService');
Module._load = originalLoad;

const tokenFor = (user) => `Bearer ${jwt.sign(user, process.env.JWT_SECRET)}`;

test.describe('Consentimento versionado (E7-01.1)', () => {
  let server;
  let baseUrl;

  test.before(async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/users', userRoutes);
    app.use('/api/consents', consentRoutes);
    await new Promise((resolve) => {
      server = app.listen(0, resolve);
    });
    baseUrl = `http://127.0.0.1:${server.address().port}/api`;
  });

  test.after(() => server.close());
  test.beforeEach(() => {
    db.reset();
    auditEvents.length = 0;
  });

  async function call(method, path, { body, auth } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (auth) headers.Authorization = auth;
    const res = await fetch(`${baseUrl}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json() };
  }

  test.describe('política vigente', () => {
    test('GET /consents/policy é público e devolve finalidade, versão e texto rascunho', async () => {
      const res = await call('GET', '/consents/policy');
      assert.equal(res.status, 200);
      const [purpose] = res.body.purposes;
      assert.equal(purpose.purpose, PURPOSE);
      assert.equal(purpose.version, CURRENT_VERSION);
      assert.equal(purpose.required, true);
      assert.match(purpose.text, /RASCUNHO/);
    });
  });

  test.describe('cadastro (POST /users)', () => {
    test('sem aceite do termo, a conta não é criada', async () => {
      const { consents, ...withoutConsent } = VALID_SIGNUP;
      const res = await call('POST', '/users', { body: withoutConsent });

      assert.equal(res.status, 400);
      assert.equal(res.body.code, 'CONSENT_REQUIRED');
      assert.equal(db.users.length, 0);
      assert.equal(db.log.includes('BEGIN'), false);
    });

    test('aceite de versão desatualizada é rejeitado (409) sem criar conta', async () => {
      const res = await call('POST', '/users', {
        body: { ...VALID_SIGNUP, consents: [{ purpose: PURPOSE, version: '0.0-antiga' }] },
      });

      assert.equal(res.status, 409);
      assert.equal(res.body.code, 'CONSENT_VERSION_OUTDATED');
      assert.equal(db.users.length, 0);
    });

    test('com aceite vigente, grava usuário e consentimento na mesma transação', async () => {
      const res = await call('POST', '/users', { body: VALID_SIGNUP });

      assert.equal(res.status, 201);
      assert.equal(db.users.length, 1);
      assert.deepEqual(
        db.consents.map(({ user_id, purpose, version, decision, ip_address }) => ({ user_id, purpose, version, decision, ip_address })),
        [{ user_id: db.users[0].id, purpose: PURPOSE, version: CURRENT_VERSION, decision: 'accepted', ip_address: '203.0.113.10' }]
      );
      const begin = db.log.indexOf('BEGIN');
      const consentInsert = db.log.indexOf('INSERT INTO consents');
      const commit = db.log.indexOf('COMMIT');
      assert.ok(begin < consentInsert && consentInsert < commit);
      assert.ok(auditEvents.some((event) => event.action === 'CONSENT_ACCEPTED'));
    });

    test('se o consentimento falha ao gravar, nem o usuário fica no banco (rollback)', async () => {
      db.failConsentInsert = true;
      const res = await call('POST', '/users', { body: VALID_SIGNUP });

      assert.equal(res.status, 500);
      assert.ok(db.log.includes('ROLLBACK'));
      assert.equal(db.log.includes('COMMIT'), false);
      assert.equal(db.users.length, 0);
      assert.equal(db.consents.length, 0);
    });
  });

  test.describe('aceite, recusa e revogação (POST /consents)', () => {
    const gestante = tokenFor({ id: 7, role: 'gestante' });

    test('exige JWT', async () => {
      assert.equal((await call('GET', '/consents/me')).status, 401);
      assert.equal((await call('POST', '/consents', { body: { purpose: PURPOSE, decision: 'accepted', version: CURRENT_VERSION } })).status, 401);
    });

    test('revogação muda o estado sem apagar o aceite anterior (trilha preservada)', async () => {
      await call('POST', '/consents', { auth: gestante, body: { purpose: PURPOSE, decision: 'accepted', version: CURRENT_VERSION } });
      const res = await call('POST', '/consents', { auth: gestante, body: { purpose: PURPOSE, decision: 'revoked' } });

      assert.equal(res.status, 201);
      assert.equal(res.body.status.purposes[0].status, 'revoked');
      assert.equal(res.body.status.required, true);
      assert.deepEqual(db.consents.map((row) => row.decision), ['accepted', 'revoked']);
      assert.ok(auditEvents.some((event) => event.action === 'CONSENT_REVOKED'));
    });

    test('recusa fica registrada e mantém o termo pendente', async () => {
      const res = await call('POST', '/consents', { auth: gestante, body: { purpose: PURPOSE, decision: 'refused', version: CURRENT_VERSION } });

      assert.equal(res.status, 201);
      assert.equal(res.body.status.purposes[0].status, 'refused');
      assert.deepEqual(res.body.status.pending, [{ purpose: PURPOSE, version: CURRENT_VERSION }]);
    });

    test('o titular é sempre o usuário do token, mesmo enviando outro user_id (IDOR)', async () => {
      await call('POST', '/consents', {
        auth: gestante,
        body: { purpose: PURPOSE, decision: 'accepted', version: CURRENT_VERSION, user_id: 999, userId: 999 },
      });
      assert.deepEqual(db.consents.map((row) => row.user_id), [7]);

      const other = await call('GET', '/consents/me', { auth: tokenFor({ id: 8, role: 'gestante' }) });
      assert.equal(other.body.purposes[0].status, 'pending');
    });

    test('rejeita versão antiga, decisão inválida e finalidade desconhecida sem gravar', async () => {
      const outdated = await call('POST', '/consents', { auth: gestante, body: { purpose: PURPOSE, decision: 'accepted', version: '0.0-antiga' } });
      const badDecision = await call('POST', '/consents', { auth: gestante, body: { purpose: PURPOSE, decision: 'talvez', version: CURRENT_VERSION } });
      const badPurpose = await call('POST', '/consents', { auth: gestante, body: { purpose: 'marketing', decision: 'accepted', version: CURRENT_VERSION } });

      assert.deepEqual([outdated.status, badDecision.status, badPurpose.status], [409, 400, 400]);
      assert.equal(db.consents.length, 0);
    });
  });

  test.describe('nova versão do termo exige novo aceite', () => {
    test('aceite de versão anterior fica "outdated" e o termo volta a ser exigido', async () => {
      db.consents.push({ id: 1, user_id: 7, purpose: PURPOSE, version: '0.0-antiga', decision: 'accepted', created_at: new Date() });
      const status = await getConsentStatus(db, { userId: 7, role: 'gestante' });

      assert.equal(status.purposes[0].status, 'outdated');
      assert.equal(status.required, true);
      assert.deepEqual(status.pending, [{ purpose: PURPOSE, version: CURRENT_VERSION }]);
    });

    test('papéis fora da política (ex.: médico) não ficam bloqueados enquanto o P.O. não decidir', async () => {
      const status = await getConsentStatus(db, { userId: 9, role: 'medico' });
      assert.equal(status.required, false);
    });
  });

  test.describe('login informa termo pendente', () => {
    async function seedUser(acceptedVersion) {
      const hash = await bcrypt.hash('senha-sintetica-123', 4);
      db.users.push({ id: 7, name: 'Maria', email: 'maria.exemplo@example.com', password: hash, is_active: true, role: 'gestante', email_lookup_hash: 'hash:maria.exemplo@example.com' });
      if (acceptedVersion) {
        db.consents.push({ id: 1, user_id: 7, purpose: PURPOSE, version: acceptedVersion, decision: 'accepted', created_at: new Date() });
      }
    }
    const login = () => call('POST', '/users/login', { body: { email: 'maria.exemplo@example.com', password: 'senha-sintetica-123' } });

    test('com aceite vigente, consent.required é false', async () => {
      await seedUser(CURRENT_VERSION);
      const res = await login();
      assert.equal(res.status, 200);
      assert.deepEqual(res.body.consent, { required: false, pending: [] });
    });

    test('com aceite de versão anterior, login sinaliza o novo aceite', async () => {
      await seedUser('0.0-antiga');
      const res = await login();
      assert.equal(res.status, 200);
      assert.deepEqual(res.body.consent, { required: true, pending: [{ purpose: PURPOSE, version: CURRENT_VERSION }] });
    });

    test('se o status não puder ser lido, o login continua funcionando', async () => {
      await seedUser(CURRENT_VERSION);
      db.failConsentRead = true;
      const res = await login();
      assert.equal(res.status, 200);
      assert.equal(res.body.consent, null);
      assert.ok(res.body.token);
    });
  });
});
