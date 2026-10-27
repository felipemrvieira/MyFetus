# Testes de contrato e regressão do motor de risco

Este documento registra como a baseline executável do motor é protegida por testes. A cobertura é técnica e sintética: ela verifica que o código continua respeitando o catálogo versionado, mas não aprova novos limiares clínicos.

## O que é verificado

- cada regra presente em `apps/api/data/alert-rules.json` possui um caso versionado em `apps/api/data/risk-regression-fixtures.json`;
- os limites inclusivos e exclusivos registrados no catálogo continuam produzindo o alerta esperado;
- a combinação de regras é preservada quando um valor atinge mais de um limiar, como pressão grave e idade gestacional de 42 semanas;
- o cenário normal não cria alertas;
- categorias sem dados retornam `pending_data`, e categorias sem contrato de curva/calendário retornam `pending_decision`;
- valores fora da faixa plausível e tipos inválidos falham explicitamente;
- as respostas permanecem determinísticas e carregam evidência/ação nas regras alertadas.

## Fonte dos casos

O arquivo de fixtures tem `fixtureVersion` e `catalogVersion`. Os casos são sintéticos, voltados à cobertura de contrato, e estão marcados como `technical-baseline-awaiting-po`: qualquer mudança de limiar, severidade, texto ou regra deve atualizar o catálogo, as fixtures e a decisão funcional correspondente no mesmo PR.

As categorias de altura uterina e vacinação continuam com `pending_decision`, porque a curva P10–P90 e o calendário por idade gestacional ainda não estão modelados no motor. O teste garante que elas não sejam tratadas como verdes nem gerem alerta por aproximação.

## Execução

```bash
npm --prefix apps/api run test:ci
```

O relatório da suíte deve indicar todos os casos de `riskEngineContract.test.js` aprovados. A alteração de uma regra sem atualizar o caso correspondente faz o teste de cobertura falhar antes do merge.
