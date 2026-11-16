import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  AnalytePoint,
  calculateYDomain,
  formatChartData,
  getTrendBadgeInfo,
} from '../utils/analyteChartData';

describe('analyteChartData mobile helper', () => {
  it('formatChartData lida com lista vazia sem quebrar', () => {
    const res = formatChartData([]);
    assert.deepStrictEqual(res.data, []);
    assert.strictEqual(res.usesGestationalWeeks, false);
  });

  it('formatChartData usa semanas de idade gestacional quando presentes', () => {
    const points: AnalytePoint[] = [
      {
        id: 1,
        observed_at: '2026-03-01',
        observed_at_label: '01/03/2026',
        gestational_age_weeks: 12.0,
        gestational_age_label: '12 sem',
        value: 11.5,
        unit: 'g/dL',
        reference_low: 12.0,
        reference_high: 15.0,
        is_out_of_reference: true,
        is_out_of_threshold: false,
      },
      {
        id: 2,
        observed_at: '2026-04-01',
        observed_at_label: '01/04/2026',
        gestational_age_weeks: 16.4,
        gestational_age_label: '16 sem 3 d',
        value: 10.8,
        unit: 'g/dL',
        reference_low: 12.0,
        reference_high: 15.0,
        is_out_of_reference: true,
        is_out_of_threshold: true,
      },
    ];

    const { data, usesGestationalWeeks } = formatChartData(points);
    assert.strictEqual(usesGestationalWeeks, true);
    assert.strictEqual(data.length, 2);
    assert.strictEqual(data[0].x, 12.0);
    assert.strictEqual(data[0].y, 11.5);
    assert.strictEqual(data[1].x, 16.4);
    assert.strictEqual(data[1].y, 10.8);
  });

  it('formatChartData faz fallback para sequencial quando falta idade gestacional', () => {
    const points: AnalytePoint[] = [
      {
        id: 1,
        observed_at: '2026-03-01',
        observed_at_label: '01/03/2026',
        gestational_age_weeks: null,
        gestational_age_label: null,
        value: 90,
        unit: 'mg/dL',
        reference_low: 70,
        reference_high: 99,
        is_out_of_reference: false,
        is_out_of_threshold: false,
      },
      {
        id: 2,
        observed_at: '2026-04-01',
        observed_at_label: '01/04/2026',
        gestational_age_weeks: null,
        gestational_age_label: null,
        value: 95,
        unit: 'mg/dL',
        reference_low: 70,
        reference_high: 99,
        is_out_of_reference: false,
        is_out_of_threshold: true,
      },
    ];

    const { data, usesGestationalWeeks } = formatChartData(points);
    assert.strictEqual(usesGestationalWeeks, false);
    assert.strictEqual(data[0].x, 1);
    assert.strictEqual(data[1].x, 2);
  });

  it('calculateYDomain engloba os valores, limite de corte e faixas de laboratório com respiro', () => {
    const points: AnalytePoint[] = [
      {
        id: 1,
        observed_at: '2026-03-01',
        observed_at_label: '01/03/2026',
        gestational_age_weeks: 10,
        gestational_age_label: '10 sem',
        value: 10.0,
        unit: 'g/dL',
        reference_low: 12.0,
        reference_high: 15.0,
        is_out_of_reference: true,
        is_out_of_threshold: true,
      },
    ];

    const [minY, maxY] = calculateYDomain(points, 11.0); // threshold = 11.0
    // O menor valor é 10.0 (ponto), o maior é 15.0 (ref high)
    assert.ok(minY <= 10.0, 'minY deve ser menor ou igual ao menor ponto');
    assert.ok(maxY >= 15.0, 'maxY deve ser maior ou igual ao limite superior do laboratório');
    assert.ok(minY >= 0, 'minY não deve ser negativo');
  });

  it('getTrendBadgeInfo retorna rótulos e estilos acessíveis para cada direção', () => {
    const stable = getTrendBadgeInfo('stable');
    assert.strictEqual(stable.label, 'Estável');

    const rising = getTrendBadgeInfo('rising');
    assert.strictEqual(rising.label, 'Em elevação');

    const falling = getTrendBadgeInfo('falling');
    assert.strictEqual(falling.label, 'Em declínio');

    const insufficient = getTrendBadgeInfo('insufficient_data');
    assert.match(insufficient.label, /insuficientes/i);
  });
});
