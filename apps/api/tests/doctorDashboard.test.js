const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const express = require('express');
const jwt = require('jsonwebtoken');

const {
  DashboardQueryError,
  PAGE_SIZE,
  buildDashboard,
  parseDashboardQuery,
  pickWorstAlert,
} = require('../services/doctorDashboardService');

process.env.JWT_SECRET = 'doctor-dashboard-test-secret';

// Dados sintéticos: nenhum dado real de paciente.
function patient(id, nome, ig = 20) {
  return { pregnant_id: id, nome, ig_semanas: ig };
}

function alert(pregnantId, severity, status, lastSeen) {
  return { pregnant_id: pregnantId, severity, status, last_seen_at: lastSeen };
}

test.describe('ordenação por gravidade (decisão do P.O. em #102)', () => {
  test('segue a ordem vermelho/amarelo não reconhecido, vermelho/amarelo reconhecido, sem alerta', () => {
    const patients = [
      patient(1, 'Sem alerta'),
      patient(2, 'Amarelo reconhecido'),
      patient(3, 'Vermelho reconhecido'),
      patient(4, 'Amarelo pendente'),
      patient(5, 'Vermelho pendente'),
    ];
    const alerts = [
      alert(2, 'yellow', 'acknowledged', '2026-10-29T10:00:00Z'),
      alert(3, 'red', 'acknowledged', '2026-10-29T10:00:00Z'),
      alert(4, 'yellow', 'open', '2026-10-29T10:00:00Z'),
      alert(5, 'red', 'open', '2026-10-29T10:00:00Z'),
    ];

    const result = buildDashboard(patients, alerts);

    assert.deepEqual(result.pacientes.map((item) => item.nome), [
      'Vermelho pendente',
      'Amarelo pendente',
      'Vermelho reconhecido',
      'Amarelo reconhecido',
      'Sem alerta',
    ]);
  });

  test('empate na mesma faixa: alerta mais recente primeiro', () => {
    const result = buildDashboard(
      [patient(1, 'Antigo'), patient(2, 'Recente')],
      [
        alert(1, 'red', 'open', '2026-10-20T10:00:00Z'),
        alert(2, 'red', 'open', '2026-10-29T10:00:00Z'),
      ]
    );

    assert.deepEqual(result.pacientes.map((item) => item.nome), ['Recente', 'Antigo']);
  });

  test('sem alerta: ordem alfabética, de forma determinística', () => {
    const result = buildDashboard([patient(2, 'Beatriz'), patient(1, 'Ana')], []);
    assert.deepEqual(result.pacientes.map((item) => item.nome), ['Ana', 'Beatriz']);
  });

  test('alerta encerrado (closed) não conta', () => {
    const result = buildDashboard(
      [patient(1, 'Encerrado')],
      [alert(1, 'red', 'closed', '2026-10-29T10:00:00Z')]
    );

    assert.equal(result.pacientes[0].pior_alerta, null);
    assert.equal(result.contadores.sem_alerta, 1);
  });

  test('pior alerta: amarelo pendente vem antes de vermelho reconhecido', () => {
    const worst = pickWorstAlert([
      alert(1, 'red', 'acknowledged', '2026-10-29T10:00:00Z'),
      alert(1, 'yellow', 'open', '2026-10-01T10:00:00Z'),
    ]);

    assert.equal(worst.severity, 'yellow');
    assert.equal(worst.status, 'open');
  });

  test('resumo traz só nome, IG, pior alerta, data e contagem de pendentes', () => {
    const result = buildDashboard(
      [patient(1, 'Ana', 28)],
      [
        alert(1, 'red', 'open', '2026-10-29T10:00:00Z'),
        alert(1, 'yellow', 'open', '2026-10-28T10:00:00Z'),
      ]
    );

    assert.deepEqual(result.pacientes[0], {
      pregnant_id: 1,
      nome: 'Ana',
      ig_semanas: 28,
      pior_alerta: { gravidade: 'red', reconhecido: false, data: '2026-10-29T10:00:00.000Z' },
      alertas_nao_reconhecidos: 2,
    });
  });

  test('IG ausente ou inválida vira null', () => {
    const result = buildDashboard([patient(1, 'Sem gestação', null)], []);
    assert.equal(result.pacientes[0].ig_semanas, null);
  });
});

test.describe('filtros, contadores e paginação', () => {
  const patients = [
    patient(1, 'Ana Vermelha'),
    patient(2, 'Bia Amarela'),
    patient(3, 'Clara Reconhecida'),
    patient(4, 'Débora Sem Alerta'),
  ];
  const alerts = [
    alert(1, 'red', 'open', '2026-10-29T10:00:00Z'),
    alert(2, 'yellow', 'open', '2026-10-29T10:00:00Z'),
    alert(3, 'red', 'acknowledged', '2026-10-29T10:00:00Z'),
  ];

  test('filtro por gravidade', () => {
    const red = buildDashboard(patients, alerts, parseDashboardQuery({ gravidade: 'red' }));
    assert.deepEqual(red.pacientes.map((item) => item.pregnant_id), [1, 3]);

    const none = buildDashboard(patients, alerts, parseDashboardQuery({ gravidade: 'none' }));
    assert.deepEqual(none.pacientes.map((item) => item.pregnant_id), [4]);
  });

  test('filtro por status de reconhecimento', () => {
    const pending = buildDashboard(patients, alerts, parseDashboardQuery({ status: 'pendente' }));
    assert.deepEqual(pending.pacientes.map((item) => item.pregnant_id), [1, 2]);

    const acknowledged = buildDashboard(patients, alerts, parseDashboardQuery({ status: 'reconhecido' }));
    assert.deepEqual(acknowledged.pacientes.map((item) => item.pregnant_id), [3]);
  });

  test('busca por nome ignora maiúsculas e acentos', () => {
    const result = buildDashboard(patients, alerts, parseDashboardQuery({ busca: 'DEBORA' }));
    assert.deepEqual(result.pacientes.map((item) => item.pregnant_id), [4]);
  });

  test('contadores cobrem todas as pacientes, independente do filtro', () => {
    const expected = { vermelho: 2, amarelo: 1, sem_alerta: 1, nao_reconhecidos: 2 };

    const all = buildDashboard(patients, alerts);
    const filtered = buildDashboard(patients, alerts, parseDashboardQuery({ gravidade: 'none' }));

    assert.deepEqual(all.contadores, expected);
    assert.deepEqual(filtered.contadores, expected);
    assert.equal(all.total, 4);
    assert.equal(filtered.total, 1);
    const sum = all.contadores.vermelho + all.contadores.amarelo + all.contadores.sem_alerta;
    assert.equal(sum, all.total);
  });

  test('paginação de 20 por página', () => {
    const many = Array.from({ length: 45 }, (_, index) => patient(index + 1, `Gestante ${String(index + 1).padStart(2, '0')}`));

    const first = buildDashboard(many, []);
    const third = buildDashboard(many, [], parseDashboardQuery({ pagina: '3' }));
    const beyond = buildDashboard(many, [], parseDashboardQuery({ pagina: '4' }));

    assert.equal(PAGE_SIZE, 20);
    assert.equal(first.pacientes.length, 20);
    assert.equal(first.total_paginas, 3);
    assert.equal(third.pacientes.length, 5);
    assert.equal(third.pacientes[0].nome, 'Gestante 41');
    assert.equal(beyond.pacientes.length, 0);
  });

  test('parâmetros inválidos são rejeitados', () => {
    const invalid = [
      { gravidade: 'green' },
      { status: 'open' },
      { pagina: '0' },
      { pagina: '1.5' },
      { pagina: 'abc' },
      { busca: 'x'.repeat(101) },
      { busca: ['a', 'b'] },
    ];
    for (const query of invalid) {
      assert.throws(() => parseDashboardQuery(query), DashboardQueryError, JSON.stringify(query));
    }
  });
});

// ---------------------------------------------------------------- HTTP

const LINKS = [
  { doctor_id: 303, pregnant_id: 1, status: 'active' },
  { doctor_id: 303, pregnant_id: 2, status: 'inactive' },
  { doctor_id: 404, pregnant_id: 3, status: 'active' },
];
const PATIENT_NAMES = { 1: 'Gestante Vinculada', 2: 'Vínculo Inativo', 3: 'Paciente De Outro Médico' };
const queryLog = [];

const clientMock = {
  async query(sql, params = []) {
    queryLog.push({ sql, params });

    if (sql.includes('FROM doctors')) {
      return { rows: [{ approval_status: 'approved' }] };
    }

    if (sql.includes('JOIN doctor_patient_links')) {
      // Reproduz o filtro do SQL real: vínculo ativo com o médico do token.
      const rows = LINKS
        .filter((link) => link.doctor_id === Number(params[0]) && link.status === 'active')
        .map((link) => ({
          pregnant_id: link.pregnant_id,
          patient_name: PATIENT_NAMES[link.pregnant_id],
          birthdate: '1990-01-01',
          semanas_gestacao: 24,
        }));
      return { rows };
    }

    if (sql.includes('FROM alert_events')) {
      const ids = params[0];
      return {
        rows: [
          alert(1, 'red', 'open', '2026-10-29T10:00:00Z'),
          alert(3, 'red', 'open', '2026-10-29T10:00:00Z'),
        ].filter((row) => ids.includes(row.pregnant_id)),
      };
    }

    return { rows: [] };
  },
};

const mocks = {
  '../backend': clientMock,
  '../services/clinicalDataService': { decryptPregnantSummary: (row) => row },
  '../services/auditService': { audit() {} },
};
const originalRequire = Module.prototype.require;
Module.prototype.require = function (request) {
  if (Object.prototype.hasOwnProperty.call(mocks, request)) return mocks[request];
  return originalRequire.apply(this, arguments);
};

const doctorRoutes = require('../routes/doctors');

test.describe('GET /api/doctors/me/dashboard', () => {
  let server;
  let baseUrl;

  test.before(async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/doctors', doctorRoutes);
    server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  test.after(() => {
    Module.prototype.require = originalRequire;
    server.close();
  });

  test.beforeEach(() => queryLog.splice(0));

  function get(path, user) {
    const headers = user
      ? { Authorization: `Bearer ${jwt.sign(user, process.env.JWT_SECRET)}` }
      : {};
    return fetch(`${baseUrl}${path}`, { headers });
  }

  test('médico vê só as pacientes com vínculo ativo', async () => {
    const response = await get('/api/doctors/me/dashboard', { id: 303, role: 'medico' });
    assert.equal(response.status, 200);

    const body = await response.json();
    assert.deepEqual(body.pacientes.map((item) => item.nome), ['Gestante Vinculada']);
    assert.equal(body.contadores.vermelho, 1);

    const alertQuery = queryLog.find(({ sql }) => sql.includes('FROM alert_events'));
    assert.deepEqual(alertQuery.params[0], [1], 'alertas só das pacientes autorizadas');
  });

  test('médico sem pacientes vinculadas recebe lista vazia, sem consultar alertas', async () => {
    const response = await get('/api/doctors/me/dashboard', { id: 999, role: 'medico' });
    assert.equal(response.status, 200);

    const body = await response.json();
    assert.equal(body.total, 0);
    assert.deepEqual(body.pacientes, []);
    assert.equal(queryLog.some(({ sql }) => sql.includes('FROM alert_events')), false);
  });

  test('gestante e admin recebem 403 sem consultar pacientes', async () => {
    for (const role of ['gestante', 'admin']) {
      queryLog.splice(0);
      const response = await get('/api/doctors/me/dashboard', { id: 101, role });
      assert.equal(response.status, 403, role);
      assert.equal(queryLog.some(({ sql }) => sql.includes('doctor_patient_links')), false, role);
    }
  });

  test('sem token recebe 401', async () => {
    const response = await get('/api/doctors/me/dashboard');
    assert.equal(response.status, 401);
  });

  test('parâmetro inválido recebe 400 sem consultar o banco de pacientes', async () => {
    const response = await get('/api/doctors/me/dashboard?gravidade=verde', { id: 303, role: 'medico' });
    assert.equal(response.status, 400);
    assert.equal(queryLog.some(({ sql }) => sql.includes('doctor_patient_links')), false);
  });
});
