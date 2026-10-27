import assert from 'node:assert/strict';
import test from 'node:test';
import { getFetalHistoryDomain, normalizeFetalHistory } from '../utils/fetalHistory';

test.describe('histórico de biometria fetal', () => {
  test.it('normaliza, filtra dados inválidos e ordena por idade gestacional', () => {
    const records = normalizeFetalHistory([
      {
        id: 2,
        measured_at: '2026-11-20',
        gestational_age_weeks: 30,
        estimated_weight_grams: 1500,
        expected_median_weight_grams: 1450,
        percentile: 55,
        z_score: 0.1,
      },
      {
        id: 1,
        measured_at: '2026-11-01',
        gestational_age_weeks: 28,
        estimated_weight_grams: 1100,
        expected_median_weight_grams: 1150,
        percentile: 42,
        z_score: -0.2,
      },
      { id: 3, gestational_age_weeks: 31 },
    ]);

    assert.deepEqual(records.map((record) => record.id), [1, 2]);
    assert.equal(records[0].estimated_weight_grams, 1100);
  });

  test.it('limita o histórico ao volume máximo do gráfico', () => {
    const records = normalizeFetalHistory(Array.from({ length: 205 }, (_, index) => ({
      id: index + 1,
      measured_at: `2026-01-${String((index % 28) + 1).padStart(2, '0')}`,
      gestational_age_weeks: 10 + (index % 33),
      estimated_weight_grams: 500 + index,
      expected_median_weight_grams: 550 + index,
      percentile: 50,
      z_score: 0,
    })));

    assert.equal(records.length, 200);
  });

  test.it('calcula domínio com margem e eixo gestacional seguro', () => {
    const records = normalizeFetalHistory([{
      id: 1,
      measured_at: '2026-11-01',
      gestational_age_weeks: 28,
      estimated_weight_grams: 1100,
      expected_median_weight_grams: 1000,
      percentile: 55,
      z_score: 0.1,
    }]);

    assert.deepEqual(getFetalHistoryDomain(records), {
      x: [10, 42],
      y: [0, 1320],
    });
  });
});
