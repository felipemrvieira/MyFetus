# Execução Cega Reproduzível do Motor de Risco (E3-09.2)

Documento de contrato técnico e operacional da issue **#168** (subtask de **#126**), responsável por executar o motor congelado (`apps/api/services/riskEngine.js` + `apps/api/data/alert-rules.json`) contra os casos sintéticos sem violar o cegamento.

## Pré-condições e travas de cegamento

1. O arquivo de gabarito clínico precisa estar fechado (`status: "preenchido"`), com `evaluator`, `filledAt` e 100% dos IDs presentes no conjunto de casos.
2. Casos classificados como `vermelho`, `inconclusivo` ou com `faltamDados: true` exigem `justificativa` preenchida.
3. O gabarito não pode conter campos de saída do motor (`overallSeverity`, `pending_data`, `ruleId`, `categories`) nem padrões de dados pessoais (PII).
4. Se `cases` informar `frozen`, os SHA-256 (normalizados para LF) e `catalogVersion` devem coincidir com `riskEngine.js` e `alert-rules.json` em uso.
5. A gravação é **append-only**: se `runs/<roundId>/execution.json` já existir, a execução é bloqueada.

## Separação entre falha técnica e resultado clínico

Cada caso avaliado em `apps/api/services/blindValidationExecutionService.js` produz:

- `executionStatus`: `"ok"` ou `"technical_error"`.
- `clinicalResult` (quando `"ok"`):
  - `overallSeverity` (`green | yellow | red`) e `severidade` (`verde | amarelo | vermelho`);
  - `triagem` (`sem_alerta | atencao | urgente`);
  - `faltamDados` (`boolean`) e `pendingCategories` (categorias em `pending_data` com campos ausentes);
  - `regrasAcionadas` (ordenadas por severidade decrescente) e `justificativa` determinística.
- `technicalError` (quando `"technical_error"`): `{ code, message, field }`, com `clinicalResult: null`.

Se qualquer caso resultar em `technical_error`, a CLI encerra com código diferente de zero e **não grava** a rodada oficial em disco.

## Uso da CLI

A partir de `apps/api/`:

```bash
# Executar e gravar uma nova rodada (append-only)
node scripts/blindValidationRun.js --round=r01

# Com caminhos explícitos
node scripts/blindValidationRun.js \
  --round=r01 \
  --cases=data/blind-validation/cases.v1.json \
  --gabarito=data/blind-validation/gabarito.v1.json \
  --out-dir=data/blind-validation/runs

# Comprovar reprodutibilidade de uma rodada já gravada (sem sobrescrever)
node scripts/blindValidationRun.js --verify-round=r01
```

O artefato gerado fica em `apps/api/data/blind-validation/runs/<roundId>/execution.json`, registrando `catalogVersion`, SHA-256 do catálogo, motor, dataset e gabarito, `gitCommit`, `deterministicDigest` e os resultados por caso.
