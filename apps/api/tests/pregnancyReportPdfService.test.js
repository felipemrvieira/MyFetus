const { test } = require('node:test');
const assert = require('node:assert/strict');

const { extractDocumentText } = require('../services/pdfTextExtractor');
const {
  FOOTER_TEXT,
  generatePregnancyReportPdf,
  sectionItems,
} = require('../services/pregnancyReportPdfService');

function snapshotFixture() {
  return {
    report_version: 'gestation-report-v1',
    generated_at: '2026-11-16T14:00:00.000Z',
    timezone: 'America/Recife',
    period: { from: '2026-10-19', to: '2026-11-17' },
    patient: {
      pregnant_id: 7,
      name: 'Maria Sintética',
      vaccines: { status: 'not_informed', items: [] },
    },
    pregnancy: {
      id: 12,
      pregnant_id: 7,
      weeks: 24,
      dpp: '2027-02-01',
    },
    exams: {
      status: 'available',
      items: [{
        id: 4,
        document_name: 'Hemograma',
        value: 12.4,
        unit: 'g/dL',
        status: 'accepted',
        observed_at: '2026-11-10T12:00:00.000Z',
      }],
    },
    diary: {
      status: 'available',
      items: [{
        entry_date: '2026-11-10',
        systolic: 110,
        diastolic: 70,
        alarm_symptoms: [],
        other_symptoms: ['cansaço'],
        free_text: 'Registro sintético',
        weight_kg: null,
        glucose_mg_dl: null,
        reduced_fetal_movements: null,
        temperature_c: null,
      }],
    },
    alerts: { status: 'not_informed', items: [] },
  };
}

test('gera PDF válido com cabeçalho, seções vazias e rodapé obrigatório', async () => {
  const pdf = await generatePregnancyReportPdf(snapshotFixture());

  assert.ok(Buffer.isBuffer(pdf));
  assert.equal(pdf.subarray(0, 5).toString('ascii'), '%PDF-');

  const extracted = await extractDocumentText(
    { document_name: 'relatorio-gestacao.pdf', document_type: 'application/pdf' },
    { buffer: pdf, enableOcr: false }
  );
  assert.match(extracted.text, /Relatório de gestação/);
  assert.match(extracted.text, /Hemograma/);
  assert.match(extracted.text, /Não informado/);
  assert.match(extracted.text, new RegExp(FOOTER_TEXT));
  assert.match(extracted.text, /Alertas/);
});

test('mantém o estado vazio explícito nas seções do snapshot', () => {
  const sections = sectionItems(snapshotFixture());
  assert.equal(sections.find(({ title }) => title === 'Vacinas').empty, true);
  assert.equal(sections.find(({ title }) => title === 'Alertas').empty, true);
  assert.equal(sections.find(({ title }) => title === 'Exames revisados').empty, false);
});
