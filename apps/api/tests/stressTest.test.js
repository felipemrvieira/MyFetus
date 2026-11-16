const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  clinicalScenarios,
} = require('../../../scripts/stress_test/scenarios/clinical_scenarios');
const {
  evaluationCriteria,
} = require('../../../scripts/stress_test/scenarios/evaluation_criteria');
const {
  RagClient,
  RagHttpError,
  RagTimeoutError,
} = require('../../../scripts/stress_test/engine/ragClient');
const {
  evaluateRagResponse,
  runScenario,
} = require('../../../scripts/stress_test/engine/scenarioRunner');
const {
  LoadRunner,
  percentile,
} = require('../../../scripts/stress_test/engine/loadRunner');
const {
  buildMarkdown,
  buildExecutiveSummary,
} = require('../../../scripts/stress_test/generate_stress_report');

function mockResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get() {
        return 'application/json';
      },
    },
    async json() {
      return body;
    },
    async text() {
      return JSON.stringify(body);
    },
  };
}

async function testScenarioCatalogShape() {
  assert.deepStrictEqual(
    clinicalScenarios.map((scenario) => scenario.id),
    ['preeclampsia', 'diabetes_gestacional', 'ciur', 'edge_cases']
  );

  for (const scenario of clinicalScenarios) {
    assert.ok(scenario.id);
    assert.ok(scenario.nome);
    assert.ok(scenario.descricao);
    assert.ok(Array.isArray(scenario.guideline_alvo));
    assert.ok(Array.isArray(scenario.estagios));

    for (const stage of scenario.estagios) {
      assert.ok(Number.isInteger(stage.estagio));
      assert.ok(Object.prototype.hasOwnProperty.call(stage, 'semana'));
      assert.ok(stage.dados_clinicos && typeof stage.dados_clinicos === 'object');
      assert.ok(Array.isArray(stage.queries));
      assert.ok(stage.queries.length > 0);
    }
  }
}

async function testCriteriaCoverage() {
  const totalStages = clinicalScenarios.reduce(
    (total, scenario) => total + scenario.estagios.length,
    0
  );

  assert.strictEqual(evaluationCriteria.length, totalStages);

  for (const scenario of clinicalScenarios) {
    for (const stage of scenario.estagios) {
      const criteria = evaluationCriteria.find((item) => (
        item.scenario_id === scenario.id && item.estagio === stage.estagio
      ));

      assert.ok(criteria);
      assert.ok(criteria.justificativa);
    }
  }
}

async function testRagClientRetryAndTimeout() {
  let calls = 0;
  const retryClient = new RagClient({
    token: 'test-token',
    retryDelayMs: 0,
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) return mockResponse(503, { error: 'temporarily unavailable' });
      return mockResponse(200, { resultados: [], total: 0 });
    },
  });

  const response = await retryClient.query('pre-eclampsia', 5);
  assert.strictEqual(calls, 2);
  assert.strictEqual(response.attempts, 2);

  const noRetryClient = new RagClient({
    token: 'test-token',
    fetchImpl: async () => mockResponse(400, { error: 'query invalida' }),
  });

  await assert.rejects(
    () => noRetryClient.query('', 5),
    (error) => error instanceof RagHttpError && error.status === 400
  );

  const timeoutClient = new RagClient({
    token: 'test-token',
    timeoutMs: 10,
    fetchImpl: (_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      });
    }),
  });

  await assert.rejects(
    () => timeoutClient.query('teste', 5),
    (error) => error instanceof RagTimeoutError && error.timeoutMs === 10
  );
}

async function testScenarioRunnerContinuesAfterFailure() {
  let calls = 0;
  const fakeClient = {
    async query() {
      calls += 1;
      if (calls === 1) throw new Error('falha simulada');

      return {
        status: 200,
        attempts: 1,
        latencyMs: 25,
        data: {
          resultados: [{
            trecho: 'Pressão arterial e proteinúria devem ser avaliadas na suspeita.',
            fonte: 'FEBRASGO',
            relevancia: 0.9,
          }],
        },
      };
    },
  };

  const scenario = {
    id: 'preeclampsia',
    nome: 'Teste',
    guideline_alvo: ['FEBRASGO'],
    estagios: [{
      estagio: 1,
      nome: 'Estagio',
      semana: 20,
      dados_clinicos: {},
      queries: ['query 1', 'query 2'],
    }],
  };

  const report = await runScenario(scenario, fakeClient);
  assert.strictEqual(calls, 2);
  assert.strictEqual(report.queries_executadas, 2);
  assert.strictEqual(report.estagios[0].resultados[0].success, false);
  assert.strictEqual(report.estagios[0].resultados[1].success, true);
}

async function testEvaluationAndLoadMetrics() {
  const approved = evaluateRagResponse({
    resultados: [{
      trecho: 'Pressão arterial e proteinúria devem ser monitoradas.',
      fonte: 'FEBRASGO',
      relevancia: 0.85,
    }],
  }, 200, {
    fontes_esperadas: ['FEBRASGO'],
    termos_obrigatorios: ['pressão arterial', 'proteinúria'],
    relevancia_minima: 0.65,
    latencia_maxima_ms: 3000,
  });

  const rejected = evaluateRagResponse({
    resultados: [{
      trecho: 'Glicemia de jejum em teste.',
      fonte: 'Ministério da Saúde',
      relevancia: 0.85,
    }],
  }, 200, {
    fontes_esperadas: ['FEBRASGO'],
    termos_obrigatorios: ['pressão arterial', 'proteinúria'],
    relevancia_minima: 0.65,
    latencia_maxima_ms: 3000,
  });

  assert.strictEqual(approved.approved, true);
  assert.strictEqual(rejected.approved, false);
  assert.deepStrictEqual(rejected.terms_missing, ['pressão arterial', 'proteinúria']);
  assert.strictEqual(percentile([10, 20, 30, 40, 50], 50), 30);
  assert.strictEqual(percentile([10, 20, 30, 40, 50], 95), 50);
  assert.strictEqual(percentile([10, 20, 30, 40, 50], 99), 50);
}

async function testLoadRunnerSustainedConcurrency() {
  let active = 0;
  let maxActive = 0;

  const runner = new LoadRunner({
    ragClient: {
      async query() {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;

        return {
          status: 200,
          latencyMs: 5,
          data: {
            resultados: [{ relevancia: 0.75 }],
          },
        };
      },
    },
    sleepImpl: async () => {},
  });

  const report = await runner.run(['query'], {
    mode: 'sustained',
    requestsPerSecond: 6,
    durationSeconds: 1,
    maxConcurrency: 2,
  });

  assert.strictEqual(report.total_requests, 6);
  assert.ok(maxActive <= 2);
  assert.strictEqual(report.failed_requests, 0);
}

async function testReportGenerator() {
  const report = {
    generated_at: '2026-06-08T10:00:00.000Z',
    config: { mode: 'sequential' },
    scenarios: [{
      scenario_id: 'preeclampsia',
      nome: 'Pre-eclampsia',
      estagios: [{
        estagio: 1,
        nome_estagio: 'Suspeita',
        semana_gestacional: 20,
        queries_executadas: 1,
        queries_aprovadas: 0,
        taxa_aprovacao: 0,
        latencia_media_ms: 100,
        latencia_max_ms: 100,
        criteria: {
          fontes_esperadas: ['FEBRASGO'],
          termos_obrigatorios: ['pressao arterial'],
        },
        resultados: [{
          query: 'q',
          approved: false,
          success: true,
          latency_ms: 100,
          rag_response: { resultados: [] },
        }],
      }],
    }],
  };

  const summary = buildExecutiveSummary(report);
  const markdown = buildMarkdown(report);
  const tempFile = path.join(os.tmpdir(), `stress-report-${Date.now()}.md`);

  fs.writeFileSync(tempFile, markdown);
  assert.strictEqual(summary.totalQueries, 1);
  assert.ok(markdown.includes('Resumo executivo'));
  assert.ok(markdown.includes('Queries que falharam'));
  assert.ok(fs.existsSync(tempFile));
  fs.unlinkSync(tempFile);
}

async function main() {
  await testScenarioCatalogShape();
  await testCriteriaCoverage();
  await testRagClientRetryAndTimeout();
  await testScenarioRunnerContinuesAfterFailure();
  await testEvaluationAndLoadMetrics();
  await testLoadRunnerSustainedConcurrency();
  await testReportGenerator();
  console.log('OK: simulador de estresse validado sem servidor real.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
