export type FetalBiometryRecord = {
  id: number;
  measured_at: string;
  gestational_age_weeks: number;
  estimated_weight_grams: number;
  expected_median_weight_grams: number;
  percentile: number;
  z_score: number;
};

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function normalizeFetalHistory(input: unknown): FetalBiometryRecord[] {
  if (!Array.isArray(input)) return [];

  return input
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
    .map((item) => ({
      id: Number(item.id),
      measured_at: typeof item.measured_at === 'string' ? item.measured_at : '',
      gestational_age_weeks: Number(item.gestational_age_weeks),
      estimated_weight_grams: Number(item.estimated_weight_grams),
      expected_median_weight_grams: Number(item.expected_median_weight_grams),
      percentile: Number(item.percentile),
      z_score: Number(item.z_score),
    }))
    .filter((item) => (
      Number.isInteger(item.id) && item.id > 0 &&
      item.measured_at.length > 0 &&
      finiteNumber(item.gestational_age_weeks) && item.gestational_age_weeks >= 10 && item.gestational_age_weeks <= 42 &&
      finiteNumber(item.estimated_weight_grams) && item.estimated_weight_grams > 0 &&
      finiteNumber(item.expected_median_weight_grams) && item.expected_median_weight_grams > 0 &&
      finiteNumber(item.percentile) && item.percentile >= 0 && item.percentile <= 100 &&
      finiteNumber(item.z_score)
    ))
    .sort((left, right) => (
      left.gestational_age_weeks - right.gestational_age_weeks ||
      left.measured_at.localeCompare(right.measured_at) ||
      left.id - right.id
    ))
    .slice(0, 200);
}

export function getFetalHistoryDomain(records: FetalBiometryRecord[]) {
  const maximum = Math.max(
    1,
    ...records.flatMap((record) => [
      record.estimated_weight_grams,
      record.expected_median_weight_grams,
    ])
  );
  const minimumWeek = records.length > 0 ? records[0].gestational_age_weeks : 10;
  const maximumWeek = records.length > 0 ? records[records.length - 1].gestational_age_weeks : 42;

  return {
    x: [Math.min(10, minimumWeek), Math.max(42, maximumWeek)] as [number, number],
    y: [0, Math.ceil(maximum * 1.2)] as [number, number],
  };
}
