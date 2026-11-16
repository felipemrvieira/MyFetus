const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

const FOOTER_TEXT = 'Exportação informativa. Não é documento oficial.';
const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 42;
const CONTENT_WIDTH = PAGE_WIDTH - (MARGIN * 2);
const COLORS = Object.freeze({
  ink: rgb(0.12, 0.16, 0.2),
  muted: rgb(0.35, 0.4, 0.45),
  accent: rgb(0.05, 0.35, 0.45),
  line: rgb(0.82, 0.85, 0.87),
});

const FIELD_LABELS = Object.freeze({
  id: 'Identificador',
  pregnant_id: 'Gestante',
  weeks: 'Semanas',
  is_checked: 'Acompanhamento conferido',
  dum: 'DUM',
  dpp: 'DPP',
  ccn: 'Cesariana anterior',
  dgm: 'Diabetes gestacional',
  glicemia: 'Glicemia',
  frequencia_cardiaca: 'Frequência cardíaca',
  altura_uterina: 'Altura uterina',
  regularidade_do_ciclo: 'Regularidade do ciclo',
  ig_ultrassonografia: 'IG da ultrassonografia',
  field: 'Campo',
  value: 'Valor',
});

function displayValue(value) {
  if (value === null || value === undefined || value === '') return 'Não informado';
  if (typeof value === 'boolean') return value ? 'Sim' : 'Não';
  if (Array.isArray(value)) return value.length ? value.join(', ') : 'Não informado';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function labelFor(field) {
  if (FIELD_LABELS[field]) return FIELD_LABELS[field];
  return String(field || '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatDateTime(value, timezone) {
  if (!value) return 'Não informado';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return displayValue(value);
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: timezone,
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date);
}

function wrapText(text, font, size, maxWidth) {
  const words = String(text).split(/\s+/).filter(Boolean);
  if (!words.length) return [''];
  const lines = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth || !line) {
      line = candidate;
      continue;
    }
    lines.push(line);
    line = word;
  }
  if (line) lines.push(line);
  return lines;
}

function sectionItems(snapshot) {
  const pregnancy = snapshot.pregnancy || {};
  const patient = snapshot.patient || {};
  return [
    {
      title: 'Dados da gestação',
      rows: Object.entries(pregnancy)
        .filter(([key]) => !['id', 'pregnant_id'].includes(key))
        .map(([key, value]) => `${labelFor(key)}: ${displayValue(value)}`),
    },
    {
      title: 'Vacinas',
      rows: patient.vaccines?.items?.map(({ field, value }) => `${labelFor(field)}: ${displayValue(value)}`) || [],
      empty: patient.vaccines?.status === 'not_informed',
    },
    {
      title: 'Exames revisados',
      rows: snapshot.exams?.items?.map((exam) => {
        const name = exam.document_name || exam.exam_type || `Exame ${exam.id}`;
        const result = [exam.value, exam.unit].filter((item) => item !== null && item !== undefined && item !== '').join(' ');
        return `${name}: ${result || 'Não informado'} — status ${displayValue(exam.status)}${exam.observed_at ? ` — ${displayValue(exam.observed_at).slice(0, 10)}` : ''}`;
      }) || [],
      empty: snapshot.exams?.status === 'not_informed',
    },
    {
      title: 'Diário dos últimos 30 dias',
      rows: snapshot.diary?.items?.map((entry) => {
        const values = [];
        if (entry.systolic !== null && entry.diastolic !== null) values.push(`pressão ${entry.systolic}/${entry.diastolic} mmHg`);
        if (entry.weight_kg !== null) values.push(`peso ${entry.weight_kg} kg`);
        if (entry.glucose_mg_dl !== null) values.push(`glicemia ${entry.glucose_mg_dl} mg/dL`);
        if (entry.temperature_c !== null) values.push(`temperatura ${entry.temperature_c} °C`);
        if (entry.reduced_fetal_movements !== null) values.push(`movimentos fetais reduzidos: ${displayValue(entry.reduced_fetal_movements)}`);
        if (entry.alarm_symptoms?.length) values.push(`sinais: ${entry.alarm_symptoms.join(', ')}`);
        if (entry.other_symptoms?.length) values.push(`sintomas: ${entry.other_symptoms.join(', ')}`);
        if (entry.free_text) values.push(`observação: ${entry.free_text}`);
        return `${entry.entry_date}: ${values.length ? values.join('; ') : 'Não informado'}`;
      }) || [],
      empty: snapshot.diary?.status === 'not_informed',
    },
    {
      title: 'Alertas',
      rows: snapshot.alerts?.items?.map((alert) => `${displayValue(alert.severity)} — ${displayValue(alert.status)} — ${displayValue(alert.message)}`) || [],
      empty: snapshot.alerts?.status === 'not_informed',
    },
  ];
}

function createPdfRenderer({ pdfDoc, font, boldFont }) {
  let page;
  let cursorY;

  function addPage() {
    page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    cursorY = PAGE_HEIGHT - MARGIN;
    return page;
  }

  function ensureSpace(requiredHeight = 18) {
    if (!page) addPage();
    if (cursorY - requiredHeight < MARGIN + 28) {
      addPage();
    }
  }

  function drawWrapped(text, options = {}) {
    const size = options.size || 10;
    const currentFont = options.bold ? boldFont : font;
    const color = options.color || COLORS.ink;
    const lineHeight = options.lineHeight || size + 4;
    const indent = options.indent || 0;
    const lines = wrapText(text, currentFont, size, CONTENT_WIDTH - indent);
    for (const line of lines) {
      ensureSpace(lineHeight);
      page.drawText(line, {
        x: MARGIN + indent,
        y: cursorY,
        size,
        font: currentFont,
        color,
      });
      cursorY -= lineHeight;
    }
    return lines.length * lineHeight;
  }

  function drawRule() {
    ensureSpace(10);
    page.drawLine({
      start: { x: MARGIN, y: cursorY + 3 },
      end: { x: PAGE_WIDTH - MARGIN, y: cursorY + 3 },
      thickness: 0.6,
      color: COLORS.line,
    });
    cursorY -= 8;
  }

  function drawFooter(targetPage) {
    targetPage.drawText(FOOTER_TEXT, {
      x: MARGIN,
      y: 18,
      size: 7.5,
      font,
      color: COLORS.muted,
    });
    targetPage.drawText(`Página ${pdfDoc.getPages().indexOf(targetPage) + 1}`, {
      x: PAGE_WIDTH - MARGIN - 52,
      y: 18,
      size: 7.5,
      font,
      color: COLORS.muted,
    });
  }

  return {
    addPage,
    drawFooter,
    drawRule,
    drawWrapped,
    get page() { return page; },
    get cursorY() { return cursorY; },
    set cursorY(value) { cursorY = value; },
  };
}

async function generatePregnancyReportPdf(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') {
    throw new TypeError('snapshot e obrigatorio');
  }
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const renderer = createPdfRenderer({ pdfDoc, font, boldFont });
  renderer.addPage();

  renderer.drawWrapped('Relatório de gestação', { size: 20, bold: true, color: COLORS.accent, lineHeight: 26 });
  renderer.drawWrapped('Exportação informativa', { size: 11, color: COLORS.muted, lineHeight: 18 });
  renderer.cursorY -= 8;
  renderer.drawRule();

  const identity = [
    `Gestante: ${displayValue(snapshot.patient?.name)}`,
    `Identificação da gestação: ${displayValue(snapshot.pregnancy?.id)}`,
    `Período do diário: ${displayValue(snapshot.period?.from)} a ${displayValue(snapshot.period?.to)}`,
    `Fuso horário: ${displayValue(snapshot.timezone)}`,
    `Gerado em: ${formatDateTime(snapshot.generated_at, snapshot.timezone || 'America/Recife')}`,
  ];
  identity.forEach((line) => renderer.drawWrapped(line, { size: 9, lineHeight: 14 }));
  renderer.cursorY -= 8;

  for (const section of sectionItems(snapshot)) {
    renderer.drawWrapped(section.title, { size: 13, bold: true, color: COLORS.accent, lineHeight: 18 });
    if (section.empty || !section.rows.length) {
      renderer.drawWrapped('Não informado', { size: 9.5, color: COLORS.muted, indent: 10, lineHeight: 14 });
    } else {
      section.rows.forEach((row) => renderer.drawWrapped(`• ${row}`, { size: 9.5, indent: 4, lineHeight: 14 }));
    }
    renderer.cursorY -= 6;
  }

  for (const targetPage of pdfDoc.getPages()) renderer.drawFooter(targetPage);
  return Buffer.from(await pdfDoc.save({ useObjectStreams: false }));
}

module.exports = {
  FOOTER_TEXT,
  displayValue,
  formatDateTime,
  generatePregnancyReportPdf,
  sectionItems,
  wrapText,
};
