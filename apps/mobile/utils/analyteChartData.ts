/**
 * Utilitários e Tipos para Visualização da Série de Analitos (E2-06, Issue #101).
 *
 * Fornece formatação para componentes VictoryChart, cálculo de domínio visual
 * e suporte semântico para acessibilidade e leitores de tela.
 */

export type AnalyteThreshold = {
  value: number;
  unit: string;
  label: string;
  direction: 'min' | 'max';
};

export type AnalytePoint = {
  id: number;
  document_id?: number;
  observed_at: string;
  observed_at_label: string;
  gestational_age_weeks: number | null;
  gestational_age_label: string | null;
  value: number;
  unit: string;
  reference_low: number | null;
  reference_high: number | null;
  is_out_of_reference: boolean;
  is_out_of_threshold: boolean;
};

export type AnalyteTrend = {
  has_enough_points: boolean;
  direction: 'stable' | 'rising' | 'falling' | 'insufficient_data';
  message: string;
};

export type AccessibilityRow = {
  id: number;
  date: string;
  gestational_age: string;
  value_label: string;
  reference_range: string;
  status_description: string;
  unit_conflict: boolean;
};

export type AnalyteSeriesResponse = {
  analyte: {
    id: string;
    name: string;
    unit: string;
    threshold: AnalyteThreshold;
  };
  points: AnalytePoint[];
  unit_conflict: boolean;
  trend: AnalyteTrend;
  accessibility_rows: AccessibilityRow[];
  disclaimer: string;
};

export type ChartDataPoint = {
  x: number;
  y: number;
  xLabel: string;
  point: AnalytePoint;
};

/**
 * Converte pontos retornados da API para a estrutura compatível com VictoryChart.
 * Prioriza idade gestacional no eixo X; faz fallback para índice sequencial se ausente.
 */
export function formatChartData(points: AnalytePoint[]): {
  data: ChartDataPoint[];
  usesGestationalWeeks: boolean;
} {
  if (!points || points.length === 0) {
    return { data: [], usesGestationalWeeks: false };
  }

  const allHaveWeeks = points.every(
    (p) => typeof p.gestational_age_weeks === 'number' && Number.isFinite(p.gestational_age_weeks)
  );

  const data: ChartDataPoint[] = points.map((p, index) => {
    const xVal = allHaveWeeks ? (p.gestational_age_weeks as number) : index + 1;
    const xLabel = allHaveWeeks
      ? p.gestational_age_label || `${p.gestational_age_weeks} sem`
      : p.observed_at_label || p.observed_at;

    return {
      x: xVal,
      y: p.value,
      xLabel,
      point: p,
    };
  });

  return { data, usesGestationalWeeks: allHaveWeeks };
}

/**
 * Calcula domínio visual dinâmico [minY, maxY] com respiro para limites e referências.
 */
export function calculateYDomain(points: AnalytePoint[], thresholdValue: number): [number, number] {
  const values = points.map((p) => p.value);
  values.push(thresholdValue);

  for (const p of points) {
    if (typeof p.reference_low === 'number') values.push(p.reference_low);
    if (typeof p.reference_high === 'number') values.push(p.reference_high);
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const padding = span * 0.15;

  const minY = Math.max(0, Number((min - padding).toFixed(1)));
  const maxY = Number((max + padding).toFixed(1));

  return [minY, maxY];
}

/**
 * Badge descritivo para tendência com suporte cromático de alto contraste e acessibilidade.
 */
export function getTrendBadgeInfo(direction: AnalyteTrend['direction']): {
  label: string;
  textColor: string;
  backgroundColor: string;
} {
  switch (direction) {
    case 'rising':
      return { label: 'Em elevação', textColor: '#8C3D00', backgroundColor: '#FFF0E5' };
    case 'falling':
      return { label: 'Em declínio', textColor: '#7A1C1C', backgroundColor: '#FDF0F0' };
    case 'stable':
      return { label: 'Estável', textColor: '#1E6838', backgroundColor: '#EBF8EE' };
    case 'insufficient_data':
    default:
      return { label: 'Dados insuficientes (< 3 exames)', textColor: '#4A5568', backgroundColor: '#EDF2F7' };
  }
}
