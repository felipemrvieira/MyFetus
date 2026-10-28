const test = require('node:test');
const assert = require('node:assert/strict');

const cases = require('../data/guardrail-regression-cases.json');
const { classifyQuery, GUARDRAIL_CONTRACT } = require('../services/agents/guardrailService');
const { runClinicalAgentGraph } = require('../services/agents/clinicalGraph');

test('dataset de guardrails tem 10 casos sintéticos por categoria', () => {
  assert.equal(cases.version, '1.0.0');
  assert.equal(cases.cases.length, 20);

  for (const category of ['out_of_scope', 'urgent']) {
    const categoryCases = cases.cases.filter((item) => item.category === category);
    assert.equal(categoryCases.length, 10, `categoria ${category} deve ter 10 casos`);
    assert.equal(new Set(categoryCases.map((item) => item.id)).size, 10);
  }
});

test('todos os casos aprovados bloqueiam geração e retornam a categoria esperada', async () => {
  for (const item of cases.cases) {
    const result = classifyQuery(item.query);
    assert.equal(result.category, item.category, item.id);
    assert.equal(result.decision, 'block_generation', item.id);
    assert.equal(result.contractVersion, GUARDRAIL_CONTRACT.version, item.id);

    const state = await runClinicalAgentGraph({ query: item.query }, {
      analyzeMaternal: async () => { throw new Error(`agente materno executado em ${item.id}`); },
      analyzeFetal: async () => { throw new Error(`agente fetal executado em ${item.id}`); },
    });
    assert.equal(state.guardrail_category, item.category, item.id);
    assert.equal(state.final_response, result.response, item.id);
    assert.equal(state.maternal_analysis, '', item.id);
    assert.equal(state.fetal_analysis, '', item.id);
  }
});
