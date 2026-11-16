# Comparação e Relatório de Concordância (E3-09.3)

Documento de contrato da issue **#169** (subtask de **#126**), responsável por comparar a saída cega da `E3-09.2` (`execution.json`) contra o gabarito clínico fechado e a matriz de cobertura (`coverage`).

## Regras de comparação e precedência

1. **Inconclusivos:** casos marcados como `inconclusivo` no gabarito saem do denominador da meta. Mais de `2` inconclusivos ou menos de `18` casos conclusivos tornam a rodada **inválida**.
2. **Falso negativo crítico (bloqueador absoluto):** gabarito `vermelho` e motor `!= vermelho` (prevalece sobre eventual diferença de `faltamDados`).
3. **Falso negativo não crítico:** gabarito `amarelo` e motor `verde`.
4. **Falso positivo:** motor com gravidade superior ao gabarito (registra `severityDelta`).
5. **Divergência de pendência de dados (`divergencia_pendencia_dados`):** mesma gravidade geral, divergindo apenas em `faltamDados` (conta como não-concordante na meta de `>= 90%`).

## Uso da CLI

A partir de `apps/api/`:

```bash
node scripts/blindValidationCompare.js --round=r01
```

Gera:
- `apps/api/data/blind-validation/runs/<roundId>/comparison.json`
- `docs/riscos/validacao-cega/runs/<roundId>/relatorio-concordancia.md`
