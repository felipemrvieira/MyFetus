const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

process.env.AES_KEY_VERSION = '1';
process.env.AES_ENCRYPTION_KEY_V1 = crypto.randomBytes(32).toString('hex');

const cryptoService = require('../services/cryptoService');
const {
  FhirExportError,
  buildFhirBundle,
  getFhirExport,
} = require('../services/fhirExportService');

const enc = (record, table) => cryptoService.encryptRecord(record, table);

test('buildFhirBundle cria Patient pseudonimo e observacoes FHIR R4 para os sinais previstos', () => {
  const bundle = buildFhirBundle({
    pregnancyId: 12,
    now: '2026-11-09T12:00:00.000Z',
    dailyEntries: [{
      id: 1,
      entry_date: '2026-11-08',
      systolic: 120,
      diastolic: 80,
      weight_kg: 68.4,
      glucose_mg_dl: 91,
    }],
    maternalWeights: [{ id: 2, measured_at: '2026-11-07', weight_kg: 68 }],
    labResults: [{ id: 3, observed_at: '2026-11-06', value: '90', unit: 'mg/dL' }],
  });

  assert.equal(bundle.resourceType, 'Bundle');
  assert.equal(bundle.type, 'collection');
  assert.equal(bundle.identifier.value, 'R4-experimental-v1');
  assert.equal(bundle.entry[0].resource.resourceType, 'Patient');
  assert.equal(bundle.entry[0].resource.name, undefined);
  assert.equal(bundle.entry.length, 6);

  const resources = bundle.entry.slice(1).map(({ resource }) => resource);
  assert.equal(resources.filter((r) => r.code.coding[0].code === '85354-9').length, 1);
  assert.equal(resources.filter((r) => r.code.coding[0].code === '29463-7').length, 2);
  assert.equal(resources.filter((r) => r.code.coding[0].code === '2339-0').length, 2);
  assert.ok(resources.every((r) => r.subject.reference === 'Patient/pregnancy-12'));
});

test('getFhirExport descriptografa diario/laboratorio e ignora resultado não aceito', async () => {
  const daily = {
    id: 10,
    entry_date: '2026-11-01',
    systolic: 130,
    diastolic: 85,
    weight_kg: 70,
    glucose_mg_dl: null,
  };
  const accepted = {
    id: 11,
    observed_at: '2026-11-02',
    value: '92',
    unit: 'mg/dL',
  };
  const queries = [];
  const db = {
    async query(sql, params) {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      queries.push({ normalized, params });
      if (normalized.startsWith('SELECT id, pregnant_id FROM pregnancies')) {
        return { rows: [{ id: 12, pregnant_id: 50 }] };
      }
      if (normalized.startsWith('SELECT id FROM pregnancies')) {
        return { rows: [{ id: 12 }] };
      }
      if (normalized.includes('FROM daily_entries')) {
        return { rows: [{ ...daily, ...enc(daily, 'daily_entries') }] };
      }
      if (normalized.includes('FROM maternal_weight_history')) return { rows: [] };
      if (normalized.includes('FROM lab_results')) {
        return { rows: [{ ...accepted, ...enc(accepted, 'lab_results') }] };
      }
      throw new Error(`SQL inesperado: ${normalized}`);
    },
  };

  const bundle = await getFhirExport(db, {
    pregnancyId: 12,
    crypto: cryptoService,
    now: '2026-11-09T12:00:00.000Z',
  });
  assert.equal(bundle.entry.length, 4);
  assert.equal(queries.length, 5);
  assert.ok(queries.some(({ normalized }) => normalized.includes("status IN ('accepted', 'corrected')")));
});

test('getFhirExport não mistura laboratório quando há múltiplas gestações da mesma gestante', async () => {
  const queries = [];
  const db = {
    async query(sql, params) {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      queries.push({ normalized, params });
      if (normalized.startsWith('SELECT id, pregnant_id FROM pregnancies')) {
        return { rows: [{ id: 12, pregnant_id: 50 }] };
      }
      if (normalized.startsWith('SELECT id FROM pregnancies')) {
        return { rows: [{ id: 12 }, { id: 13 }] };
      }
      if (normalized.includes('FROM daily_entries')) return { rows: [] };
      if (normalized.includes('FROM maternal_weight_history')) return { rows: [] };
      throw new Error(`SQL inesperado: ${normalized}`);
    },
  };

  const bundle = await getFhirExport(db, {
    pregnancyId: 12,
    crypto: cryptoService,
    now: '2026-11-09T12:00:00.000Z',
  });
  assert.equal(bundle.entry.length, 1);
  assert.deepEqual(bundle.extension.map((item) => item.valueCode), [
    'lab-results-omitted-multiple-pregnancies',
  ]);
  assert.equal(queries.some(({ normalized }) => normalized.includes('FROM lab_results')), false);
});

test('buildFhirBundle ignora data civil inexistente', () => {
  const bundle = buildFhirBundle({
    pregnancyId: 12,
    dailyEntries: [{ id: 1, entry_date: '2026-02-30', weight_kg: 68 }],
  });
  assert.equal(bundle.entry.length, 1);
});

test('getFhirExport rejeita gestação inexistente', async () => {
  await assert.rejects(
    () => getFhirExport({ query: async () => ({ rows: [] }) }, { pregnancyId: 99, crypto: cryptoService }),
    (error) => error instanceof FhirExportError && error.status === 404
  );
});
