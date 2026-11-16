const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const express = require('express');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = 'cross-patient-test-secret';

const PATIENTS = {
  1: { id: 1, user_id: 101, patient_name: 'Gestante A', birthdate: '1990-01-01' },
  2: { id: 2, user_id: 202, patient_name: 'Gestante B', birthdate: '1991-02-02' },
};
const PREGNANCIES = {
  11: { id: 11, pregnant_id: 1 },
  22: { id: 22, pregnant_id: 2 },
};
const LINKS = new Set(['303:1']);
const queryLog = [];

const clientMock = {
  async query(sql, params = []) {
    queryLog.push({ sql, params });

    if (sql.includes('doctor_patient_links')) {
      const key = `${Number(params[0])}:${Number(params[1])}`;
      return { rows: LINKS.has(key) ? [{ '?column?': 1 }] : [] };
    }

    if (sql.includes('FROM doctors')) {
      return { rows: [{ approval_status: 'approved' }] };
    }

    if (/SELECT id, user_id\s+FROM pregnants/.test(sql)) {
      const patient = PATIENTS[Number(params[0])];
      return { rows: patient ? [{ id: patient.id, user_id: patient.user_id }] : [] };
    }

    if (/SELECT id, pregnant_id\s+FROM pregnancies/.test(sql)) {
      const pregnancy = PREGNANCIES[Number(params[0])];
      return { rows: pregnancy ? [pregnancy] : [] };
    }

    if (/FROM pregnancies\s+WHERE pregnant_id/.test(sql)) {
      const patient = Object.values(PATIENTS).find(
        (candidate) => candidate.id === Number(params[0])
      );
      return { rows: patient ? [{ id: 11, pregnant_id: patient.id }] : [] };
    }

    if (/FROM pregnancy_events/.test(sql)) return { rows: [] };

    if (sql.includes('latest_pregnancy')) {
      const patient = PATIENTS[Number(params[0])];
      return {
        rows: patient
          ? [{ ...patient, latest_pregnancy: { weeks: 20, glicemia: 90 } }]
          : [],
      };
    }

    if (/SELECT p\.\*, u\.name AS patient_name/.test(sql)) {
      const patient = PATIENTS[Number(params[0])];
      return { rows: patient ? [{ ...patient }] : [] };
    }

    if (sql.includes('FROM alert_events')) {
      return {
        rows: [{
          id: 900, alert_key: 'k', pregnancy_id: Number(params[0]), pregnant_id: 1,
          rule_id: 'E3-07.bleeding', severity: 'red', status: 'open', source_type: 'daily_entry',
          source_id: 'entry-a', message: 'x', signal_codes: ['sangramento'],
        }],
      };
    }

    if (sql.includes('fetal_biometry_history')) {
      return { rows: [{ id: 1, pregnancy_id: Number(params[0]) }] };
    }
    if (sql.includes('maternal_weight_history')) {
      return { rows: [{ id: 2, pregnancy_id: Number(params[0]) }] };
    }

    return { rows: [] };
  },
};

const mocks = {
  '../backend': clientMock,
  '../services/clinicalDataService': {
    decryptPregnantDetails: (row, pregnancy, events) => ({ ...row, pregnancy, events }),
    decryptPregnantSummary: (row) => row,
  },
  '../services/auditService': { audit() {} },
};
const originalRequire = Module.prototype.require;
Module.prototype.require = function (request) {
  if (Object.prototype.hasOwnProperty.call(mocks, request)) return mocks[request];
  return originalRequire.apply(this, arguments);
};

const pregnantRoutes = require('../routes/pregnants');
const clinicalHistoryRoutes = require('../routes/clinicalHistory');
const alertEventsRoutes = require('../routes/alertEvents');

function tokenFor(user) {
  return `Bearer ${jwt.sign(user, process.env.JWT_SECRET)}`;
}

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/pregnants', pregnantRoutes);
  app.use('/api/history', clinicalHistoryRoutes);
  app.use('/api/alert-events', alertEventsRoutes);
  return app;
}

test.describe('autorização cruzada entre gestantes', () => {
  let server;
  let baseUrl;

  test.before(async () => {
    server = createApp().listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  test.after(() => {
    Module.prototype.require = originalRequire;
    server.close();
  });

  test.beforeEach(() => queryLog.splice(0));

  async function get(path, user) {
    return fetch(`${baseUrl}${path}`, {
      headers: { Authorization: tokenFor(user) },
    });
  }

  test('gestante A lê o próprio prontuário', async () => {
    const response = await get('/api/pregnants/1', { id: 101, role: 'gestante' });

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.patient_name, 'Gestante A');
  });

  test('gestante A não lê o prontuário da gestante B', async () => {
    const response = await get('/api/pregnants/2', { id: 101, role: 'gestante' });

    assert.equal(response.status, 403);
    assert.equal(
      queryLog.some(({ sql }) => /FROM pregnancies\s+WHERE pregnant_id/.test(sql)),
      false,
      'a consulta às gestações de B não deve ocorrer após a negativa'
    );
  });

  test('gestante A não lê o histórico clínico da gestante B', async () => {
    const response = await get('/api/history/pregnancies/22', { id: 101, role: 'gestante' });

    assert.equal(response.status, 403);
    assert.equal(
      queryLog.some(({ sql }) => sql.includes('fetal_biometry_history') || sql.includes('maternal_weight_history')),
      false,
      'o histórico de B não deve ser consultado após a negativa'
    );
  });

  test('médico só lê alertas da gestante com vínculo ativo', async () => {
    const denied = await get('/api/pregnants/2/alerts', { id: 303, role: 'medico' });
    assert.equal(denied.status, 403);

    const allowed = await get('/api/pregnants/1/alerts', { id: 303, role: 'medico' });
    assert.equal(allowed.status, 200);
  });

  test('E3-07: alerta da gestante A não aparece para médico sem vínculo com A', async () => {
    const denied = await get('/api/alert-events/pregnancies/22', { id: 303, role: 'medico' });
    assert.equal(denied.status, 403);
    assert.equal(
      queryLog.some(({ sql }) => sql.includes('FROM alert_events')),
      false,
      'alert_events de B não deve ser consultado após a negativa'
    );

    const otherDoctor = await get('/api/alert-events/pregnancies/11', { id: 404, role: 'medico' });
    assert.equal(otherDoctor.status, 403);

    const allowed = await get('/api/alert-events/pregnancies/11', { id: 303, role: 'medico' });
    assert.equal(allowed.status, 200);
    const body = await allowed.json();
    assert.equal(body.events[0].rule_id, 'E3-07.bleeding');
  });

  test('E3-07: gestante B não lê alertas da gestante A', async () => {
    const response = await get('/api/alert-events/pregnancies/11', { id: 202, role: 'gestante' });
    assert.equal(response.status, 403);
  });
});
