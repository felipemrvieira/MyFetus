/**
 * Serviço de Série Temporal de Analitos (E2-06, Issue #101).
 *
 * Gera a evolução de hemoglobina e glicemia de jejum ao longo da gestação,
 * consumindo exclusivamente resultados aceitos ou corrigidos (status in accepted, corrected).
 *
 * Decisões clínicas do P.O. Dr. Rui Pontes:
 * - Apenas hemoglobina e glicemia de jejum formam série (TOTG e casual ficam de fora).
 * - Faixa de laboratório ponto a ponto + limite aprovado (Hb 11 g/dL; Jejum 92 mg/dL).
 * - Tendência a partir de 3 pontos sem interpolação de dados ausentes.
 * - Bloqueio de mistura de unidades.
 * - Acessibilidade textual e aviso de não-diagnóstico obrigatórios.
 */
const { LabResultError } = require('./labResultService');

const DAY_IN_MS = 24 * 60 * 60 * 1000;

const CLINICAL_THRESHOLDS = Object.freeze({
  hemoglobin: {
    id: 'hemoglobin',
    name: 'Hemoglobina',
    default_unit: 'g/dL',
    value: 11,
    unit: 'g/dL',
    label: 'Limite gestacional Hb (11 g/dL)',
    direction: 'min',
    stable_delta: 0.3,
  },
  glucose: {
    id: 'glucose',
    name: 'Glicemia de Jejum',
    default_unit: 'mg/dL',
    value: 92,
    unit: 'mg/dL',
    label: 'Limite glicemia de jejum (92 mg/dL)',
    direction: 'max',
    stable_delta: 3.0,
  },
});

function parseIsoDate(value) {
  if (!value || typeof value !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (!match) return null;
  const [, year, month, day] = match;
  const d = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (
    d.getUTCFullYear() !== Number(year) ||
    d.getUTCMonth() !== Number(month) - 1 ||
    d.getUTCDate() !== Number(day)
  ) {
    return null;
  }
  return d;
}

function calculateGestationalAge(observedAtStr, dumStr) {
  const observedDate = parseIsoDate(observedAtStr);
  const dumDate = parseIsoDate(dumStr);
  if (!observedDate || !dumDate) return null;

  const diffDays = Math.floor((observedDate.getTime() - dumDate.getTime()) / DAY_IN_MS);
  if (diffDays < 0) return null;

  const weeks = Math.floor(diffDays / 7);
  const days = diffDays % 7;
  const totalWeeks = Number((diffDays / 7).toFixed(1));
  const label = days > 0 ? `${weeks} sem ${days} d` : `${weeks} sem`;

  return {
    weeks,
    days,
    totalWeeks,
    label,
  };
}

function calculateTrend(points, analyteId) {
  if (!Array.isArray(points) || points.length < 3) {
    return {
      has_enough_points: false,
      direction: 'insufficient_data',
      message: 'Necessário ao menos 3 exames na mesma unidade para cálculo de tendência.',
    };
  }

  const thresholdConfig = CLINICAL_THRESHOLDS[analyteId] || CLINICAL_THRESHOLDS.hemoglobin;
  const stableDelta = thresholdConfig.stable_delta;

  const firstTime = parseIsoDate(points[0].observed_at)?.getTime() ?? 0;
  const xs = [];
  const ys = [];

  for (const pt of points) {
    const t = parseIsoDate(pt.observed_at)?.getTime() ?? firstTime;
    const day = (t - firstTime) / DAY_IN_MS;
    xs.push(day);
    ys.push(Number(pt.value));
  }

  const n = points.length;
  const sumX = xs.reduce((acc, v) => acc + v, 0);
  const sumY = ys.reduce((acc, v) => acc + v, 0);
  const sumXY = xs.reduce((acc, v, idx) => acc + v * ys[idx], 0);
  const sumX2 = xs.reduce((acc, v) => acc + v * v, 0);

  const denominator = n * sumX2 - sumX * sumX;
  let slope = 0;
  if (denominator !== 0) {
    slope = (n * sumXY - sumX * sumY) / denominator;
  }

  const spanDays = xs[n - 1] - xs[0];
  const totalChange = spanDays > 0 ? slope * spanDays : ys[n - 1] - ys[0];

  let direction = 'stable';
  let message = `Tendência estável nos últimos ${n} exames`;

  if (totalChange >= stableDelta) {
    direction = 'rising';
    message = `Tendência em elevação nos últimos ${n} exames`;
  } else if (totalChange <= -stableDelta) {
    direction = 'falling';
    message = `Tendência em declínio nos últimos ${n} exames`;
  }

  return {
    has_enough_points: true,
    direction,
    message,
  };
}

function formatBrDate(isoStr) {
  const d = parseIsoDate(isoStr);
  if (!d) return isoStr || '';
  const day = String(d.getUTCDate()).padStart(2, '0');
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const year = d.getUTCFullYear();
  return `${day}/${month}/${year}`;
}

function parseNumeric(value) {
  if (value === null || value === undefined) return null;
  const num = Number(String(value).replace(',', '.'));
  return Number.isFinite(num) ? num : null;
}

function formatReferenceRange(low, high, unit) {
  return low !== null && high !== null ? `${low} a ${high} ${unit}` : 'Não informada';
}

async function getAnalyteSeries(client, { pregnantId, analyteId, crypto }) {
  if (!pregnantId) {
    throw new LabResultError('INVALID_PREGNANT', 'pregnantId obrigatório', 400);
  }

  const normalizedAnalyte = analyteId === 'fasting_glucose' ? 'glucose' : analyteId;
  const meta = CLINICAL_THRESHOLDS[normalizedAnalyte];
  if (!meta) {
    throw new LabResultError(
      'INVALID_ANALYTE',
      'Analito não suportado para série temporal. Apenas hemoglobina e glicemia de jejum formam série.',
      400
    );
  }

  // 1. Busca DUM da gestação ativa para cálculo de idade gestacional
  let dum = null;
  const pregResult = await client.query(
    `SELECT dum FROM pregnancies WHERE pregnant_id = $1 ORDER BY id DESC LIMIT 1`,
    [pregnantId]
  );
  if (pregResult.rows && pregResult.rows[0]) {
    const decPreg = crypto.decryptRecord(pregResult.rows[0], 'pregnancies');
    dum = decPreg.dum || null;
  }

  // 2. Busca exames aceitos ou corrigidos no banco
  let querySql = `
    SELECT * FROM lab_results
     WHERE pregnant_id = $1
       AND analyte_id = $2
       AND status IN ('accepted', 'corrected')
  `;
  const queryParams = [pregnantId, normalizedAnalyte];

  // Glicemia exige filtro estrito por jejum
  if (normalizedAnalyte === 'glucose') {
    querySql += ` AND exam_type = $3`;
    queryParams.push('fasting');
  }

  const results = await client.query(querySql, queryParams);
  const rawRows = results.rows || [];

  // Decifra e filtra registros com valor numérico e data válida
  const usableRecords = [];
  for (const row of rawRows) {
    if (row.status && row.status !== 'accepted' && row.status !== 'corrected') continue;
    const decrypted = crypto.decryptRecord(row, 'lab_results');
    const numericVal = parseNumeric(decrypted.value);
    if (numericVal === null) continue;
    if (!decrypted.observed_at) continue;

    usableRecords.push({
      id: decrypted.id,
      document_id: decrypted.document_id,
      value: numericVal,
      unit: decrypted.unit ? String(decrypted.unit).trim() : meta.default_unit,
      reference_low: parseNumeric(decrypted.reference_low),
      reference_high: parseNumeric(decrypted.reference_high),
      observed_at: decrypted.observed_at,
      exam_type: decrypted.exam_type,
      status: decrypted.status,
      version: decrypted.version,
    });
  }

  // Ordena cronologicamente por observed_at ASC, id ASC
  usableRecords.sort((a, b) => {
    const diff = (parseIsoDate(a.observed_at)?.getTime() ?? 0) - (parseIsoDate(b.observed_at)?.getTime() ?? 0);
    return diff !== 0 ? diff : a.id - b.id;
  });

  // Determina unidade primária e detecta conflitos
  const primaryUnit = meta.default_unit;
  const points = [];
  const conflictingRecords = [];

  for (const rec of usableRecords) {
    if (rec.unit.toLowerCase() === primaryUnit.toLowerCase()) {
      const ga = dum ? calculateGestationalAge(rec.observed_at, dum) : null;
      const isOutOfReference =
        (rec.reference_low !== null && rec.value < rec.reference_low) ||
        (rec.reference_high !== null && rec.value > rec.reference_high);

      const isOutOfThreshold =
        meta.direction === 'min' ? rec.value < meta.value : rec.value > meta.value;

      points.push({
        id: rec.id,
        document_id: rec.document_id,
        observed_at: rec.observed_at,
        observed_at_label: formatBrDate(rec.observed_at),
        gestational_age_weeks: ga ? ga.totalWeeks : null,
        gestational_age_label: ga ? ga.label : null,
        value: rec.value,
        unit: rec.unit,
        reference_low: rec.reference_low,
        reference_high: rec.reference_high,
        is_out_of_reference: Boolean(isOutOfReference),
        is_out_of_threshold: Boolean(isOutOfThreshold),
      });
    } else {
      conflictingRecords.push(rec);
    }
  }

  const hasUnitConflict = conflictingRecords.length > 0;
  const trend = calculateTrend(points, normalizedAnalyte);

  // Constrói tabela acessível textual (inclui todos os registros para transparência médica)
  const accessibilityRows = [];

  for (const pt of points) {
    let statusDesc = 'Dentro dos limites normativos';
    if (pt.is_out_of_threshold) {
      statusDesc = meta.direction === 'min'
        ? `Abaixo do limite gestacional de ${meta.value} ${meta.unit}`
        : `Acima do limite gestacional de ${meta.value} ${meta.unit}`;
    }
    if (pt.is_out_of_reference) {
      statusDesc += '. Fora da faixa de referência informada pelo laboratório';
    }

    const refRange = formatReferenceRange(pt.reference_low, pt.reference_high, pt.unit);

    accessibilityRows.push({
      id: pt.id,
      date: pt.observed_at_label,
      gestational_age: pt.gestational_age_label || 'Não informada',
      value_label: `${pt.value} ${pt.unit}`,
      reference_range: refRange,
      status_description: statusDesc,
      unit_conflict: false,
    });
  }

  for (const rec of conflictingRecords) {
    const refRange = formatReferenceRange(rec.reference_low, rec.reference_high, rec.unit);

    accessibilityRows.push({
      id: rec.id,
      date: formatBrDate(rec.observed_at),
      gestational_age: 'Não calculada',
      value_label: `${rec.value} ${rec.unit}`,
      reference_range: refRange,
      status_description: `Unidade divergente (${rec.unit}). Bloqueado de plotagem na curva de ${primaryUnit}.`,
      unit_conflict: true,
    });
  }

  return {
    analyte: {
      id: meta.id,
      name: meta.name,
      unit: primaryUnit,
      threshold: {
        value: meta.value,
        unit: meta.unit,
        label: meta.label,
        direction: meta.direction,
      },
    },
    points,
    unit_conflict: hasUnitConflict,
    trend,
    accessibility_rows: accessibilityRows,
    disclaimer: 'Histórico para acompanhamento clínico. Não é diagnóstico.',
  };
}

module.exports = {
  CLINICAL_THRESHOLDS,
  calculateGestationalAge,
  calculateTrend,
  getAnalyteSeries,
};
