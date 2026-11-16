# Deliberação do P.O. e Reexecução (E3-09.4)

Documento de contrato da issue **#170** (subtask de **#126**), responsável por registrar a deliberação formal do P.O. e médico responsável (`aprovado | corrigir | inconclusivo`) após o relatório de concordância (`E3-09.3`) e comparar rodadas consecutivas sem sobrescrever o histórico.

## Regras e travas

1. **Deliberação individual obrigatória:** toda divergência e todo caso `inconclusivo` exige `caseId`, `acao` (`ajustar_regra | ajustar_limiar | ajustar_severidade | nova_regra | remover_regra | manter_motor | revisar_caso`), `justificativa` e `responsavel`.
2. **Travas de aprovação (`aprovado`):**
   - Bloqueado se houver `falso_negativo_critico > 0` ou rodada inválida (`inconclusivos > 2` ou `conclusivos < 18`).
   - Concordância `< 90%` exige `exceptionJustification` explícita.
3. **Imutabilidade e comparabilidade:**
   - `decision.json` e `decisao-po.md` são gravados em modo *append-only*.
   - Ao informar `--previous-round=<id>`, gera `comparativo-rodadas.md` pareando por `caseId` (`resolvido`, `persistente`, `regressao`, `mantido_concordante`, `casosAdicionados` e `casosRemovidos`).

## Uso da CLI

A partir de `apps/api/`:

```bash
node scripts/blindValidationDecide.js \
  --round=r02 \
  --decision=data/blind-validation/runs/r02/decision-input.json \
  --previous-round=r01
```
