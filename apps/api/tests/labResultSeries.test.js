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
} = require('../services/labResultService');
const {
  calculateGestationalAge,
  calculateTrend,
  getAnalyteSeries,
  CLINICAL_THRESHOLDS,
} = require('../services/labResultSeriesService');

const enc = (record, table) => cryptoService.encryptRecord(record, table);

// ------------------------------------------------------------------ Testes Puros
test.describe('Cálculos puros de série e tendência (E2-06)', () => {
  test('calculateGestationalAge calcula semanas e dias a partir da DUM', () => {
    // 28 dias após a DUM = 4 semanas exatas
    const exact = calculateGestationalAge('2026-06-29', '2026-06-01');
    assert.deepStrictEqual(exact, {
      weeks: 4,
      days: 0,
      totalWeeks: 4,
      label: '4 sem',
    });

    // 38 dias após DUM = 5 semanas e 3 dias (5.4 semanas)
    const withDays = calculateGestationalAge('2026-07-09', '2026-06-01');
    assert.deepStrictEqual(withDays, {
      weeks: 5,
      days: 3,
      totalWeeks: 5.4,
      label: '5 sem 3 d',
    });

    // Data anterior à DUM ou datas inválidas retornam null
    assert.strictEqual(calculateGestationalAge('2026-05-20', '2026-06-01'), null);
    assert.strictEqual(calculateGestationalAge(null, '2026-06-01'), null);
    assert.strictEqual(calculateGestationalAge('2026-07-01', null), null);
    assert.strictEqual(calculateGestationalAge('invalido', '2026-06-01'), null);
  });

  test('calculateTrend respeita o mínimo de 3 pontos do P.O. e calcula estabilidade e direção', () => {
    // Menos de 3 pontos => dados insuficientes
    const zero = calculateTrend([], 'hemoglobin');
    assert.strictEqual(zero.has_enough_points, false);
    assert.strictEqual(zero.direction, 'insufficient_data');

    const two = calculateTrend([
      { observed_at: '2026-06-01', value: 12.0 },
      { observed_at: '2026-07-01', value: 12.2 },
    ], 'hemoglobin');
    assert.strictEqual(two.has_enough_points, false);
    assert.strictEqual(two.direction, 'insufficient_data');

    // 3 pontos estáveis (Hb variando dentro da margem de 0.3)
    const stable = calculateTrend([
      { observed_at: '2026-06-01', value: 12.0 },
      { observed_at: '2026-07-01', value: 12.1 },
      { observed_at: '2026-08-01', value: 12.05 },
    ], 'hemoglobin');
    assert.strictEqual(stable.has_enough_points, true);
    assert.strictEqual(stable.direction, 'stable');
    assert.match(stable.message, /estável/i);

    // 3 pontos em elevação
    const rising = calculateTrend([
      { observed_at: '2026-06-01', value: 10.0 },
      { observed_at: '2026-07-01', value: 11.2 },
      { observed_at: '2026-08-01', value: 12.5 },
    ], 'hemoglobin');
    assert.strictEqual(rising.has_enough_points, true);
    assert.strictEqual(rising.direction, 'rising');
    assert.match(rising.message, /elevação/i);

    // 3 pontos em declínio
    const falling = calculateTrend([
      { observed_at: '2026-06-01', value: 13.0 },
      { observed_at: '2026-07-01', value: 11.5 },
      { observed_at: '2026-08-01', value: 10.2 },
    ], 'hemoglobin');
    assert.strictEqual(falling.has_enough_points, true);
    assert.strictEqual(falling.direction, 'falling');
    assert.match(falling.message, /declínio/i);
  });
});

// ------------------------------------------------------------------ Mock Database
function createMockDb() {
  const tables = {
    pregnants: [{ id: 10, user_id: 100 }],
    pregnancies: [
      {
        id: 1,
        pregnant_id: 10,
        ...enc({ dum: '2026-01-01', dpp: '2026-10-08', weeks: 20 }, 'pregnancies'),
        encryption_key_version: 1,
      },
    ],
    links: [{ doctor_id: 200, pregnant_id: 10, status: 'active' }],
    users: [
      { id: 200, role: 'medico' },
      { id: 300, role: 'medico' }, // médico sem vínculo
      { id: 100, role: 'gestante' },
      { id: 1, role: 'admin' },
    ],
    lab_results: [],
    audit_logs: [],
  };

  return {
    tables,
    async query(sql, params = []) {
      const text = sql.replace(/\s+/g, ' ').trim();
      const t = this.tables;

      if (text.startsWith('SELECT approval_status')) {
        return { rows: [{ approval_status: 'approved' }] };
      }
      if (text.includes('FROM doctor_patient_links')) {
        const [doctorId, pregnantId] = params;
        return {
          rows: t.links.filter(
            (l) => l.doctor_id === doctorId && l.pregnant_id === Number(pregnantId) && l.status === 'active'
          ),
        };
      }
      if (text.startsWith('SELECT dum FROM pregnancies')) {
        const [pregnantId] = params;
        const matches = t.pregnancies
          .filter((p) => p.pregnant_id === Number(pregnantId))
          .sort((a, b) => b.id - a.id);
        return { rows: matches.slice(0, 1) };
      }
      if (text.includes('FROM lab_results')) {
        const [pregnantId, analyteId] = params;
        let rows = t.lab_results.filter(
          (r) => r.pregnant_id === Number(pregnantId) &&
                 r.analyte_id === analyteId &&
                 ['accepted', 'corrected'].includes(r.status)
        );
        if (params.length > 2 && params[2] !== undefined) {
          // exam_type filter
          rows = rows.filter((r) => r.exam_type === params[2]);
        }
        return { rows };
      }
      if (text.startsWith('INSERT INTO audit_logs')) {
        t.audit_logs.push({ sql, params });
        return { rows: [] };
      }
      throw new Error(`SQL inesperado no teste de série: ${text}`);
    },
  };
}

// ------------------------------------------------------------------ Testes de Serviço
test.describe('Serviço de série temporal de analito (getAnalyteSeries)', () => {
  test('recusa analito que não forma série temporal', async () => {
    const db = createMockDb();
    await assert.rejects(
      async () => getAnalyteSeries(db, { pregnantId: 10, analyteId: 'leukocytes', crypto: cryptoService }),
      (err) => err instanceof LabResultError && err.code === 'INVALID_ANALYTE'
    );
  });

  test('série de hemoglobina ignora pendentes e rejeitados, calcula referências e idade gestacional', async () => {
    const db = createMockDb();
    // 1 pendente, 1 rejeitado, 2 aceitos, 1 corrigido
    db.tables.lab_results = [
      {
        id: 1, pregnant_id: 10, line_index: 0, analyte_id: 'hemoglobin', status: 'pending',
        ...enc({ value: '11.0', unit: 'g/dL', observed_at: '2026-02-01' }, 'lab_results'),
      },
      {
        id: 2, pregnant_id: 10, line_index: 1, analyte_id: 'hemoglobin', status: 'rejected',
        ...enc({ value: '9.0', unit: 'g/dL', observed_at: '2026-02-05' }, 'lab_results'),
      },
      {
        id: 3, pregnant_id: 10, line_index: 2, analyte_id: 'hemoglobin', status: 'accepted',
        ...enc({ value: '10.5', unit: 'g/dL', reference_low: '12.0', reference_high: '16.0', observed_at: '2026-02-15' }, 'lab_results'),
      },
      {
        id: 4, pregnant_id: 10, line_index: 3, analyte_id: 'hemoglobin', status: 'corrected',
        ...enc({ value: '11.8', unit: 'g/dL', reference_low: '12.0', reference_high: '16.0', observed_at: '2026-03-15' }, 'lab_results'),
      },
    ];

    const res = await getAnalyteSeries(db, { pregnantId: 10, analyteId: 'hemoglobin', crypto: cryptoService });

    assert.strictEqual(res.analyte.id, 'hemoglobin');
    assert.strictEqual(res.analyte.name, 'Hemoglobina');
    assert.strictEqual(res.analyte.threshold.value, 11);
    assert.strictEqual(res.points.length, 2);

    // Primeiro ponto aceito (10.5) está abaixo do threshold (11) e fora da ref lab (12-16)
    const p1 = res.points[0];
    assert.strictEqual(p1.value, 10.5);
    assert.strictEqual(p1.is_out_of_threshold, true);
    assert.strictEqual(p1.is_out_of_reference, true);
    assert.strictEqual(p1.gestational_age_weeks > 0, true);

    // Segundo ponto (11.8) está acima do threshold clínico (11), mas ainda fora da ref do lab (12-16)
    const p2 = res.points[1];
    assert.strictEqual(p2.value, 11.8);
    assert.strictEqual(p2.is_out_of_threshold, false);
    assert.strictEqual(p2.is_out_of_reference, true);

    // Disclaimer legal obrigatório
    assert.strictEqual(res.disclaimer, 'Histórico para acompanhamento clínico. Não é diagnóstico.');
  });

  test('glicemia filtra estritamente jejum e descarta casual e TOTG', async () => {
    const db = createMockDb();
    db.tables.lab_results = [
      {
        id: 10, pregnant_id: 10, line_index: 0, analyte_id: 'glucose', exam_type: 'fasting', status: 'accepted',
        ...enc({ value: '95', unit: 'mg/dL', reference_low: '70', reference_high: '99', observed_at: '2026-02-10' }, 'lab_results'),
      },
      {
        id: 11, pregnant_id: 10, line_index: 1, analyte_id: 'glucose', exam_type: 'casual', status: 'accepted',
        ...enc({ value: '140', unit: 'mg/dL', observed_at: '2026-02-12' }, 'lab_results'),
      },
      {
        id: 12, pregnant_id: 10, line_index: 2, analyte_id: 'glucose', exam_type: 'ogtt75g', timepoint: '1h', status: 'accepted',
        ...enc({ value: '160', unit: 'mg/dL', observed_at: '2026-02-15' }, 'lab_results'),
      },
    ];

    const res = await getAnalyteSeries(db, { pregnantId: 10, analyteId: 'glucose', crypto: cryptoService });
    assert.strictEqual(res.points.length, 1);
    assert.strictEqual(res.points[0].value, 95);
    assert.strictEqual(res.points[0].is_out_of_threshold, true); // 95 > 92 (limite gestacional de jejum)
  });

  test('segrega unidades divergentes e ativa flag unit_conflict', async () => {
    const db = createMockDb();
    db.tables.lab_results = [
      {
        id: 20, pregnant_id: 10, line_index: 0, analyte_id: 'hemoglobin', status: 'accepted',
        ...enc({ value: '11.5', unit: 'g/dL', observed_at: '2026-02-01' }, 'lab_results'),
      },
      {
        id: 21, pregnant_id: 10, line_index: 1, analyte_id: 'hemoglobin', status: 'accepted',
        ...enc({ value: '115', unit: 'g/L', observed_at: '2026-02-10' }, 'lab_results'),
      },
    ];

    const res = await getAnalyteSeries(db, { pregnantId: 10, analyteId: 'hemoglobin', crypto: cryptoService });
    assert.strictEqual(res.unit_conflict, true);
    assert.strictEqual(res.points.length, 1);
    assert.strictEqual(res.points[0].unit, 'g/dL');
    assert.strictEqual(res.accessibility_rows.length, 2); // Ambas aparecem na tabela acessível
  });
});

// ------------------------------------------------------------------ Testes de Rota HTTP
test.describe('Rota HTTP GET /api/lab-results/series', () => {
  const auditEvents = [];
  const testDb = createMockDb();

  const mocks = {
    '../backend': {
      query: (...args) => testDb.query(...args),
      connect: async () => ({ query: (...args) => testDb.query(...args), release() {} }),
    },
    '../services/auditService': { audit: (req, event) => auditEvents.push(event) },
    '../utils/logger': { error() {}, warn() {}, info() {}, request() {} },
  };

  const originalLoad = Module._load;
  Module._load = function (request) {
    if (Object.prototype.hasOwnProperty.call(mocks, request)) return mocks[request];
    return originalLoad.apply(this, arguments);
  };

  const labResultsRoutes = require('../routes/labResults');

  const tokenFor = (user) => `Bearer ${jwt.sign(user, process.env.JWT_SECRET)}`;
  const LINKED_DOCTOR = tokenFor({ id: 200, role: 'medico' });
  const UNLINKED_DOCTOR = tokenFor({ id: 300, role: 'medico' });
  const ADMIN = tokenFor({ id: 1, role: 'admin' });
  const PREGNANT = tokenFor({ id: 100, role: 'gestante' });

  let server;
  let baseUrl;

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
    auditEvents.length = 0;
    testDb.tables.lab_results = [
      {
        id: 101, pregnant_id: 10, line_index: 0, analyte_id: 'hemoglobin', status: 'accepted',
        ...enc({ value: '11.2', unit: 'g/dL', reference_low: '12.0', reference_high: '15.0', observed_at: '2026-03-01' }, 'lab_results'),
      },
    ];
  });

  async function fetchSeries(token, query = '') {
    const response = await fetch(`${baseUrl}/series${query}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: token } : {}),
      },
    });
    return { status: response.status, body: await response.json() };
  }

  test('sem token responde 401', async () => {
    const { status } = await fetchSeries(null, '?pregnant_id=10&analyte_id=hemoglobin');
    assert.strictEqual(status, 401);
  });

  test('gestante e admin respondem 403 (apenas médico vinculado)', async () => {
    const r1 = await fetchSeries(PREGNANT, '?pregnant_id=10&analyte_id=hemoglobin');
    assert.strictEqual(r1.status, 403);

    const r2 = await fetchSeries(ADMIN, '?pregnant_id=10&analyte_id=hemoglobin');
    assert.strictEqual(r2.status, 403);
  });

  test('médico sem vínculo responde 403', async () => {
    const { status, body } = await fetchSeries(UNLINKED_DOCTOR, '?pregnant_id=10&analyte_id=hemoglobin');
    assert.strictEqual(status, 403);
    assert.match(body.error, /não vinculado/i);
  });

  test('parâmetros ausentes respondem 400', async () => {
    const r1 = await fetchSeries(LINKED_DOCTOR, '?analyte_id=hemoglobin');
    assert.strictEqual(r1.status, 400);

    const r2 = await fetchSeries(LINKED_DOCTOR, '?pregnant_id=10');
    assert.strictEqual(r2.status, 400);
  });

  test('médico vinculado acessa série e gera auditoria sem PII clínica', async () => {
    const { status, body } = await fetchSeries(LINKED_DOCTOR, '?pregnant_id=10&analyte_id=hemoglobin');
    assert.strictEqual(status, 200);
    assert.strictEqual(body.analyte.id, 'hemoglobin');
    assert.strictEqual(body.points.length, 1);
    assert.strictEqual(body.points[0].value, 11.2);
    assert.strictEqual(body.disclaimer, 'Histórico para acompanhamento clínico. Não é diagnóstico.');

    assert.strictEqual(auditEvents.length, 1);
    const event = auditEvents[0];
    assert.strictEqual(event.action, 'LAB_RESULTS_SERIES_VIEWED');
    assert.strictEqual(event.resource, 'lab_results');
    assert.strictEqual(event.resource_id, 10);
    assert.deepStrictEqual(event.detail, { pregnant_id: 10, analyte_id: 'hemoglobin' });
    assert.strictEqual(event.detail.value, undefined, 'Não deve vazar valor clínico no log de auditoria');
  });
});
