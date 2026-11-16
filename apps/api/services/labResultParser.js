const { mapClinicalTerm, normalizeText } = require('../utils/loincMapper');

const PARSER_VERSION = '1.0.0';
const DATE_PATTERN = /(?:(\d{2})[\/-](\d{2})[\/-](\d{4})|(\d{4})-(\d{2})-(\d{2}))/;
const NUMBER_PATTERN = /[-+]?\d+(?:[.,]\d+)?/g;

const ANALYTES = [
  { id: 'hemoglobin', label: 'Hemoglobina', pattern: /(?:hemoglobina(?:\s+total)?|\bhb\b)/i, mappingTerm: 'Hemoglobina' },
  { id: 'hematocrit', label: 'Hematócrito', pattern: /(?:hemat[oó]crito|\bhct\b)/i, mappingTerm: 'Hematócrito' },
  { id: 'leukocytes', label: 'Leucócitos', pattern: /(?:leuc[oó]citos?|\bwbc\b)/i, mappingTerm: 'Leucócitos' },
  { id: 'platelets', label: 'Plaquetas', pattern: /(?:plaquetas?|\bplt\b)/i, mappingTerm: 'Plaquetas' },
  { id: 'glucose', label: 'Glicemia', pattern: /glic(?:emia|ose)|glucose/i, mappingTerm: 'Glicemia' },
  { id: 'urine_protein', label: 'Proteína urinária', pattern: /prote[ií]na(?:\s+urin[aá]ria)?|proteinúria/i, mappingTerm: 'Proteína urinária' },
  { id: 'urine_leukocytes', label: 'Leucócitos urinários', pattern: /leuc[oó]citos?\s+(?:urin[aá]rios?|por\s+campo)/i, mappingTerm: 'Leucócitos urinários' },
  { id: 'urine_nitrite', label: 'Nitrito urinário', pattern: /nitrito(?:\s+urin[aá]rio)?/i, mappingTerm: 'Nitrito urinário' },
];

function parseNumber(value) {
  if (value === null || value === undefined) return null;
  const normalized = String(value).replace(',', '.');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function extractObservedAt(text, explicitDate) {
  const candidate = explicitDate || String(text || '').match(/data(?:\s+do\s+exame)?\s*[:=-]?\s*((?:\d{2}[\/-]\d{2}[\/-]\d{4})|(?:\d{4}-\d{2}-\d{2}))/i)?.[1];
  if (!candidate) return null;
  const match = String(candidate).match(DATE_PATTERN);
  if (!match) return null;
  const [, dayBr, monthBr, yearBr, yearIso, monthIso, dayIso] = match;
  const day = dayBr || dayIso;
  const month = monthBr || monthIso;
  const year = yearBr || yearIso;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (date.getUTCFullYear() !== Number(year) || date.getUTCMonth() !== Number(month) - 1 || date.getUTCDate() !== Number(day)) return null;
  return date.toISOString().slice(0, 10);
}

function extractUnit(text) {
  return String(text || '').match(/(?:mg\s*\/\s*dL|g\s*\/\s*dL|10\^?3\s*\/\s*[uµ]L|10\s*\*\*?3\s*\/\s*[uµ]L|U\s*\/\s*L|ng\s*\/\s*mL|%|mg\/L)/i)?.[0] || null;
}

function normalizeUnit(unit) {
  if (!unit) return null;
  return unit.replace(/\s+/g, '').replace(/µ/g, 'u').replace(/mg\/dl/i, 'mg/dL').replace(/g\/dl/i, 'g/dL');
}

function extractReference(text) {
  const match = String(text || '').match(/(?:ref(?:er[eê]ncia)?|refer[eê]ncia)\s*[:=]?\s*([-+]?\d+(?:[.,]\d+)?)\s*(?:-|a|até)\s*([-+]?\d+(?:[.,]\d+)?)/i);
  if (!match) return { low: null, high: null };
  return { low: parseNumber(match[1]), high: parseNumber(match[2]) };
}

function extractValue(text, analyte) {
  const beforeReference = String(text || '').split(/\b(?:ref(?:er[eê]ncia)?|refer[eê]ncia)\b/i)[0];
  const descriptor = beforeReference.match(analyte.pattern);
  const candidateText = descriptor ? beforeReference.slice(descriptor.index + descriptor[0].length) : beforeReference;
  const numbers = candidateText.match(NUMBER_PATTERN) || [];
  const numeric = numbers.length > 0 ? parseNumber(numbers[numbers.length - 1]) : null;
  if (numeric !== null) return { valueNumeric: numeric, valueText: String(numbers[numbers.length - 1]) };

  const qualitative = beforeReference.match(/\b(positivo|positiva|negativo|negativa|reagente|n[aã]o\s+reagente|ausente|presente|tra[cç]os)\b/i)?.[1];
  return { valueNumeric: null, valueText: qualitative || null };
}

function findGlucoseContext(line) {
  const normalized = normalizeText(line);
  if (!normalized.includes('glicemia') && !normalized.includes('glicose') && !normalized.includes('glucose')) return null;
  if (/(totg|75\s*g|teste\s+oral)/i.test(line)) {
    const hour = line.match(/\b(0|1|2)\s*(?:h|hora|horas)\b/i)?.[1];
    if (hour !== undefined) return { examType: 'ogtt75g', timepoint: `${hour}h` };
    return { examType: 'ogtt75g', timepoint: /jejum|basal/i.test(line) ? '0h' : null };
  }
  if (/jejum|fasting/i.test(line)) return { examType: 'fasting', timepoint: 'fasting' };
  // Sem o tipo escrito no laudo, não adivinha: o médico informa na revisão (#61, #100).
  if (/casual|aleat[oó]ria|ao\s+acaso/i.test(line)) return { examType: 'casual', timepoint: null };
  return { examType: null, timepoint: null };
}

function extractionConfidence({ valueNumeric, valueText, unit, observedAt }) {
  let confidence = valueNumeric !== null || valueText ? 0.85 : 0.25;
  if (unit) confidence += 0.05;
  if (observedAt) confidence += 0.05;
  return Number(Math.min(confidence, 0.95).toFixed(2));
}

function buildResult(line, analyte, options) {
  const mapping = mapClinicalTerm(analyte.mappingTerm);
  const value = extractValue(line, analyte);
  const unit = normalizeUnit(extractUnit(line));
  const reference = extractReference(line);
  const observedAt = extractObservedAt(options.text, options.observedAt);
  const glucose = analyte.id === 'glucose' ? findGlucoseContext(line) : null;
  let status = 'pending_review';
  let ambiguityReason = null;

  if (mapping.status !== 'mapped' || !mapping.loinc) {
    ambiguityReason = 'loinc_not_confirmed';
  } else if (value.valueNumeric === null && !value.valueText) {
    ambiguityReason = 'value_not_recognized';
  } else if (!unit && value.valueNumeric !== null) {
    ambiguityReason = 'unit_not_confirmed';
  } else if (!observedAt) {
    ambiguityReason = 'exam_date_not_found';
  } else {
    status = 'accepted';
  }

  return {
    analyte: analyte.label,
    analyte_id: analyte.id,
    loinc: mapping.loinc || null,
    value_numeric: value.valueNumeric,
    value_text: value.valueText,
    unit,
    reference_low: reference.low,
    reference_high: reference.high,
    observed_at: observedAt,
    confidence: extractionConfidence({ ...value, unit, observedAt }),
    status,
    method: 'synthetic_text_pattern_plus_loinc_catalog',
    parser_version: PARSER_VERSION,
    raw_text: line,
    ambiguity_reason: ambiguityReason,
    exam_type: glucose?.examType || null,
    timepoint: glucose?.timepoint || null,
  };
}

function parseExamText(text, options = {}) {
  const originalText = String(text || '');
  const lines = originalText.split(/\r?\n|\|/g).map((line) => line.trim()).filter(Boolean);
  const results = [];
  const unrecognized = [];

  for (const line of lines) {
    if (/^data(?:\s+do\s+exame)?\b/i.test(line)) continue;
    const analyte = ANALYTES.find((candidate) => candidate.pattern.test(line));
    if (!analyte) {
      unrecognized.push(line);
      continue;
    }
    results.push(buildResult(line, analyte, { text: originalText, observedAt: options.observedAt }));
  }

  const accepted = results.filter((result) => result.status === 'accepted').length;
  const pending = results.length - accepted;
  return {
    parser_version: PARSER_VERSION,
    source_method: 'synthetic_text_pattern_plus_loinc_catalog',
    observed_at: extractObservedAt(originalText, options.observedAt),
    results,
    unrecognized_text: unrecognized,
    summary: {
      total_recognized: results.length,
      accepted,
      pending_review: pending,
      unrecognized: unrecognized.length,
    },
  };
}

module.exports = {
  ANALYTES,
  PARSER_VERSION,
  extractObservedAt,
  normalizeUnit,
  parseExamText,
  parseNumber,
};
