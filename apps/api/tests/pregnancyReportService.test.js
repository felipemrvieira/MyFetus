const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildDateWindow,
  buildPregnancyReportSnapshot,
  extractVaccines,
  PregnancyReportNotFoundError,
} = require('../services/pregnancyReportService');

const crypto = {
  decryptRecord(row) { return { ...row }; },
};

test('calcula os últimos 30 dias pela data local registrada', () => {
  assert.deepEqual(
    buildDateWindow(new Date('2026-11-16T02:00:00.000Z'), 'America/Recife'),
    { from: '2026-10-17', to: '2026-11-15', timezone: 'America/Recife' }
  );
});

test('seleciona somente vacinas preenchidas', () => {
  assert.deepEqual(
    extractVaccines({ vacina_dtpa: true, vacina_influenza: null, outro: 'ignorado' }),
    [{ field: 'vacina_dtpa', value: true }]
  );
});

test('monta snapshot com exames revisados, diário, alertas e estados vazios', async () => {
  const calls = [];
  const db = {
    async query(text, values) {
      calls.push({ text, values });
      if (text.includes('FROM pregnancies')) {
        return { rows: [{ id: 7, pregnant_id: 11, weeks: 24, dum: '2026-06-01', dpp: '2027-03-08' }] };
      }
      if (text.includes('FROM pregnants')) {
        return { rows: [{ id: 11, user_id: 20, vacina_dtpa: true, vacina_influenza: null }] };
      }
      if (text.includes('FROM users')) return { rows: [{ id: 20, name: 'Paciente Sintética' }] };
      if (text.includes('FROM lab_results')) {
        return { rows: [{
          id: 91, document_id: 31, analyte_id: 'hemoglobina', loinc: '718-7', document_name: 'hemograma-sintetico.pdf',
          value: 12.2, unit: 'g/dL', reference_low: 11, reference_high: 15,
          observed_at: '2026-11-10', status: 'accepted', reviewed_at: '2026-11-11',
        }] };
      }
      if (text.includes('FROM daily_entries')) {
        return { rows: [{
          id: 50, entry_key: 'entry-sintetica', pregnant_id: 11, pregnancy_id: 7,
          entry_date: '2026-11-10', timezone: 'America/Recife', version: 1,
          alarm_symptoms: [], other_symptoms: ['cansaco'], free_text: null,
          systolic: null, diastolic: null, weight_kg: 68.1, glucose_mg_dl: null,
          reduced_fetal_movements: null, temperature_c: null,
        }] };
      }
      if (text.includes('FROM alert_events')) return { rows: [] };
      throw new Error(`Consulta inesperada: ${text}`);
    },
  };

  const snapshot = await buildPregnancyReportSnapshot(db, {
    pregnancyId: 7,
    crypto,
    now: () => new Date('2026-11-16T15:00:00.000Z'),
  });

  assert.equal(snapshot.report_version, 'gestation-report-v1');
  assert.equal(snapshot.patient.pregnant_id, 11);
  assert.equal(snapshot.patient.vaccines.items.length, 1);
  assert.equal(snapshot.exams.status, 'available');
  assert.equal(snapshot.exams.items[0].status, 'accepted');
  assert.equal(snapshot.diary.items[0].weight_kg, 68.1);
  assert.equal(snapshot.alerts.status, 'not_informed');
  assert.deepEqual(calls[3].values, [11, ['accepted', 'corrected']]);
  assert.deepEqual(calls[4].values, [7, '2026-10-18', '2026-11-16']);
});

test('falha de forma explícita quando a gestação não existe', async () => {
  await assert.rejects(
    () => buildPregnancyReportSnapshot({ query: async () => ({ rows: [] }) }, {
      pregnancyId: 999,
      crypto,
      now: () => new Date('2026-11-16T12:00:00Z'),
    }),
    PregnancyReportNotFoundError
  );
});
