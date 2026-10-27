import assert from 'node:assert';
import test from 'node:test';
import {
  IMC_ADEQUADO_SOBREPESO,
  classificarAlturaUterinaPorSemana,
  classificarIMCPorSemana,
  interpolateCurve,
} from '../utils/growthChartData';

test.describe('growth chart accuracy', () => {
  test.it('classifica IMC por semana conforme casos de aceite', () => {
    const cases = [
      { week: 10, imc: 18.0, expected: 'Baixo peso' },
      { week: 20, imc: 22.4, expected: 'Adequado' },
      { week: 28, imc: 29.0, expected: 'Sobrepeso' },
      { week: 35, imc: 34.0, expected: 'Obesidade' },
      { week: 42, imc: 24.0, expected: 'Baixo peso' },
      { week: 42, imc: 27.0, expected: 'Adequado' },
    ] as const;

    for (const item of cases) {
      assert.strictEqual(
        classificarIMCPorSemana(item.week, item.imc),
        item.expected,
        `semana ${item.week}, IMC ${item.imc}`
      );
    }

    assert.strictEqual(
      interpolateCurve(IMC_ADEQUADO_SOBREPESO, 28),
      28.4,
      'a semana 28 não pode quebrar a monotonicidade da curva Atalah'
    );

    for (let index = 1; index < IMC_ADEQUADO_SOBREPESO.length; index += 1) {
      assert.ok(
        IMC_ADEQUADO_SOBREPESO[index].value >= IMC_ADEQUADO_SOBREPESO[index - 1].value,
        `curva Atalah não monotônica na posição ${index}`
      );
    }
  });

  test.it('classifica altura uterina por semana conforme casos de aceite', () => {
    const cases = [
      { week: 20, altura: 17.0, expected: 'Adequada' },
      { week: 25, altura: 18.0, expected: 'Abaixo do esperado' },
      { week: 30, altura: 29.5, expected: 'Adequada' },
      { week: 33, altura: 33.5, expected: 'Acima do esperado' },
    ] as const;

    for (const item of cases) {
      assert.strictEqual(
        classificarAlturaUterinaPorSemana(item.week, item.altura),
        item.expected,
        `semana ${item.week}, altura ${item.altura}`
      );
    }
  });
});
