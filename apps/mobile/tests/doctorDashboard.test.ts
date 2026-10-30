import assert from 'node:assert';
import test from 'node:test';
import {
  buildDashboardQuery,
  formatAlertDate,
  formatGestationalAge,
  getAlertBadge,
  mergeDashboardPages,
} from '../utils/doctorDashboard';

test.describe('dashboard do médico por gravidade', () => {
  test.it('monta a query só com os filtros preenchidos', () => {
    assert.strictEqual(
      buildDashboardQuery({ gravidade: null, status: null, busca: '  ', pagina: 1 }),
      ''
    );
    assert.strictEqual(
      buildDashboardQuery({ gravidade: 'red', status: 'pendente', busca: 'Ana Maria', pagina: 2 }),
      '?gravidade=red&status=pendente&busca=Ana%20Maria&pagina=2'
    );
  });

  test.it('estado do alerta sempre tem texto, ícone e cor', () => {
    const cases = [
      null,
      { gravidade: 'red' as const, reconhecido: false, data: '2026-10-29T10:00:00Z' },
      { gravidade: 'yellow' as const, reconhecido: true, data: '2026-10-29T10:00:00Z' },
    ];
    for (const alert of cases) {
      const badge = getAlertBadge(alert);
      assert.ok(badge.label.length > 0);
      assert.ok(badge.icon.length > 0);
      assert.ok(badge.color.startsWith('#'));
      assert.ok(badge.accessibilityLabel.length > 0);
    }
  });

  test.it('descreve gravidade e reconhecimento em texto', () => {
    const red = getAlertBadge({ gravidade: 'red', reconhecido: false, data: '2026-10-29T10:00:00Z' });
    assert.strictEqual(red.label, 'Vermelho · não reconhecido · 29/10');
    assert.strictEqual(red.icon, 'alert-circle');

    const yellow = getAlertBadge({ gravidade: 'yellow', reconhecido: true, data: '2026-10-05T10:00:00Z' });
    assert.strictEqual(yellow.label, 'Amarelo · reconhecido · 05/10');
    assert.strictEqual(yellow.icon, 'checkmark-done-circle');

    assert.strictEqual(getAlertBadge(null).label, 'Sem alerta ativo');
  });

  test.it('formata data e idade gestacional', () => {
    assert.strictEqual(formatAlertDate('data-invalida'), '');
    assert.strictEqual(formatGestationalAge(28), '28 semanas de gestação');
    assert.strictEqual(formatGestationalAge(null), 'Gestação não iniciada');
  });

  test.it('carregar mais não duplica pacientes', () => {
    const page1 = [{ pregnant_id: 1, nome: 'A', ig_semanas: 20, pior_alerta: null, alertas_nao_reconhecidos: 0 }];
    const page2 = [
      { pregnant_id: 1, nome: 'A', ig_semanas: 20, pior_alerta: null, alertas_nao_reconhecidos: 0 },
      { pregnant_id: 2, nome: 'B', ig_semanas: 22, pior_alerta: null, alertas_nao_reconhecidos: 0 },
    ];
    assert.deepStrictEqual(mergeDashboardPages(page1, page2).map((p) => p.pregnant_id), [1, 2]);
  });
});
