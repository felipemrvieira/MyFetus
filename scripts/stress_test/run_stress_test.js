#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const {
  clinicalScenarios,
  getClinicalScenario,
} = require('./scenarios/clinical_scenarios');
const { RagClient } = require('./engine/ragClient');
const { runScenario } = require('./engine/scenarioRunner');
const { LoadRunner, repeatQueries } = require('./engine/loadRunner');
const { buildMarkdown, buildExecutiveSummary } = require('./generate_stress_report');

const VALID_MODES = new Set(['sequential', 'burst', 'ramp', 'sustained', 'official']);

function getCommitHash() {
  try {
    return execSync('git rev-parse HEAD', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return 'local-dev';
  }
}

function parseArgs(argv) {
  const args = {
    all: false,
    scenario: null,
    mode: 'sequential',
    topK: 5,
    timeoutMs: Number(process.env.RAG_TIMEOUT_MS || 10000),
    concurrency: 3,
    requests: 100,
    requestsPerSecond: 5,
    durationSeconds: 10,
    output: null,
    mock: false,
    live: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === '--all') {
      args.all = true;
    } else if (arg === '--scenario') {
      args.scenario = next;
      index += 1;
    } else if (arg === '--mode') {
      args.mode = next;
      index += 1;
    } else if (arg === '--topK') {
      args.topK = Number(next);
      index += 1;
    } else if (arg === '--timeout') {
      args.timeoutMs = Number(next);
      index += 1;
    } else if (arg === '--concurrency') {
      args.concurrency = Number(next);
      index += 1;
    } else if (arg === '--requests') {
      args.requests = Number(next);
      index += 1;
    } else if (arg === '--rps') {
      args.requestsPerSecond = Number(next);
      index += 1;
    } else if (arg === '--duration') {
      args.durationSeconds = Number(next);
      index += 1;
    } else if (arg === '--output') {
      args.output = next;
      index += 1;
    } else if (arg === '--mock') {
      args.mock = true;
    } else if (arg === '--live') {
      args.live = true;
    } else if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else {
      throw new Error(`Flag desconhecida: ${arg}`);
    }
  }

  // Se nenhum token estiver no ambiente e nem for especificado --live, assume --mock por segurança (ex: CI)
  if (!args.live && !process.env.RAG_TEST_JWT && !process.env.JWT_TEST_TOKEN) {
    args.mock = true;
  }

  if (!args.help && !args.all && !args.scenario) {
    args.all = true;
  }

  if (!VALID_MODES.has(args.mode)) {
    throw new Error(`Modo inválido: ${args.mode}. Use: ${Array.from(VALID_MODES).join(', ')}.`);
  }

  return args;
}

function printHelp() {
  console.log(`Simulador de Casos Críticos - MyFetus RAG (E4-08 / #104)

Uso:
  node scripts/stress_test/run_stress_test.js --all
  node scripts/stress_test/run_stress_test.js --mock --all
  node scripts/stress_test/run_stress_test.js --live --all --concurrency 3 --requests 100
  node scripts/stress_test/run_stress_test.js --scenario edge_cases
  node scripts/stress_test/run_stress_test.js --scenario preeclampsia --mode burst --concurrency 3

Flags:
  --scenario <id>       preeclampsia | diabetes_gestacional | ciur | edge_cases
  --all                 executa todos os cenários (padrão)
  --mode <modo>         sequential | burst | ramp | sustained | official
  --mock                executa em modo determinístico com mocks em memória (CI / M2)
  --live                executa contra o backend ativo (M3)
  --topK <n>            quantidade de resultados do RAG (padrão: 5)
  --timeout <ms>        timeout por chamada (padrão: 10000ms)
  --concurrency <n>     concorrência para testes de carga (padrão: 3)
  --requests <n>        quantidade total de requisições no modo oficial (padrão: 100)
  --output <arquivo>    salva o relatório JSON especificado (além do auto-gerado em reports/)
`);
}

function selectScenarios(args) {
  if (args.all) return clinicalScenarios;

  const scenario = getClinicalScenario(args.scenario);
  if (!scenario) {
    throw new Error(`Cenário não encontrado: ${args.scenario}`);
  }

  return [scenario];
}

function formatPercent(value) {
  return `${(Number(value || 0) * 100).toFixed(1)}%`;
}

function formatNumber(value, digits = 0) {
  return Number(value || 0).toFixed(digits);
}

function printHeader(scenarios, args) {
  const scenarioLabel = args.all
    ? `Todos (${scenarios.length} cenários)`
    : `${scenarios[0].nome} (${scenarios[0].estagios.length} estágios)`;

  const envLabel = args.mock ? 'MOCK (Determinístico / CI M2)' : 'LIVE (Homologação Real M3)';

  console.log('================================================================');
  console.log('         Simulador de Casos Críticos - MyFetus RAG (E4-08)      ');
  console.log('================================================================');
  console.log(`Ambiente:     ${envLabel}`);
  console.log(`Cenário(s):   ${scenarioLabel}`);
  console.log(`Modo:         ${args.mode} | Concorrência: ${args.concurrency}`);
  console.log(`Limites SLA:  p95 <= 10.000ms | Erro <= 2.0% | Zero Perigos`);
  console.log('----------------------------------------------------------------\n');
}

function printScenarioStage(stageReport) {
  const week = stageReport.semana_gestacional == null
    ? 'semana N/A'
    : `semana ${stageReport.semana_gestacional}`;

  console.log(`[Estágio ${stageReport.estagio} - ${week}] ${stageReport.nome_estagio}`);

  stageReport.resultados.forEach((result, index) => {
    let marker = 'OK';
    if (result.dangerous_response) marker = 'PERIGO';
    else if (result.verdict === 'REJECTED') marker = 'REJEITADO';
    else if (result.verdict === 'INCONCLUSIVE') marker = 'INCONCLUSIVO';

    const relevance = result.evaluation?.max_relevance ?? 0;
    console.log(
      `  [${marker}] Query ${index + 1}: "${result.query.slice(0, 55)}..." | latência: ${result.latency_ms}ms | relevância: ${formatNumber(relevance, 2)}`
    );

    if (result.dangerous_response) {
      console.log(`    ⚠️  ALERTA CLÍNICO: ${result.evaluation?.danger_reason}`);
    }
  });

  console.log(
    `  Subtotal: ${stageReport.queries_aprovadas}/${stageReport.queries_executadas} aprovadas (${formatPercent(stageReport.taxa_aprovacao)}) | latência média: ${stageReport.latencia_media_ms}ms\n`
  );
}

function printScenarioReport(report) {
  console.log(`>>> Cenário: ${report.nome}`);
  report.estagios.forEach(printScenarioStage);
}

async function runSequentialScenarios(scenarios, client, args) {
  const reports = [];

  for (const scenario of scenarios) {
    const report = await runScenario(scenario, client, {
      topK: args.topK,
    });

    reports.push(report);
    printScenarioReport(report);
  }

  return reports;
}

function writeJsonReport(outputPath, report) {
  try {
    const resolved = path.resolve(process.cwd(), outputPath);
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, `${JSON.stringify(report, null, 2)}\n`);
    return resolved;
  } catch (err) {
    console.warn(`[AVISO] Não foi possível salvar relatório JSON em ${outputPath}: ${err.message}`);
    return null;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    return;
  }

  const scenarios = selectScenarios(args);
  printHeader(scenarios, args);

  const client = new RagClient({
    timeoutMs: args.timeoutMs,
    mock: args.mock,
    endpointType: 'chat',
  });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const commitHash = getCommitHash();

  const report = {
    generated_at: new Date().toISOString(),
    metadata: {
      commit: commitHash,
      environment: args.mock ? 'mock (CI / M2)' : 'live (M3)',
      cost_usd: '0.00',
    },
    config: args,
    scenarios: [],
    load_tests: [],
  };

  // 1. Executa avaliação de cenários com validação clínica completa
  report.scenarios = await runSequentialScenarios(scenarios, client, args);

  // 2. Se modo for oficial de estresse, executa a bateria de 100 requisições (60 clínicas / 40 edge cases)
  if (args.mode === 'official') {
    console.log('\n--- Executando Carga Mista de 100 Requisições (60 Clínicas / 40 Edge Cases) ---');
    const runner = new LoadRunner({ ragClient: client });

    const clinicalQueries = scenarios
      .filter((sc) => sc.id !== 'edge_cases')
      .flatMap((sc) => sc.estagios.flatMap((st) => st.queries));
    const edgeCaseQueries = scenarios
      .filter((sc) => sc.id === 'edge_cases')
      .flatMap((sc) => sc.estagios.flatMap((st) => st.queries));

    const total = Math.max(1, args.requests);
    const targetClinical = Math.round(total * 0.6);
    const targetEdgeCases = total - targetClinical;

    const clinicalBatch = repeatQueries(clinicalQueries, targetClinical);
    const edgeCaseBatch = repeatQueries(edgeCaseQueries, targetEdgeCases);
    const mixedBatch = [...clinicalBatch, ...edgeCaseBatch];

    const loadResult = await runner.runOfficialLoad(mixedBatch, {
      requests: args.requests,
      concurrency: args.concurrency,
      topK: args.topK,
      rpmLimit: 15,
    });
    report.load_tests.push({
      scenario_id: 'official_mixed_load',
      nome: 'Bateria Oficial de 100 Requisições',
      report: runner.buildReport('official', loadResult, args.timeoutMs),
    });
  }

  const summary = buildExecutiveSummary(report);
  report.summary = summary;

  console.log('================================================================');
  console.log(`Veredito Final: ${summary.gateVerdict}`);
  console.log(`Resumo: ${summary.totalQueries} queries | ${summary.approvedQueries} aprovadas | ${summary.dangerousCount} perigosas`);
  console.log(`Latência p95: ${summary.p95}ms (limite 10.000ms) | Taxa de erro: ${formatPercent(summary.errorRate)} (limite 2%)`);
  console.log('================================================================');

  // Geração de relatórios em reports/
  const defaultJsonPath = `reports/stress_rag_${timestamp}.json`;
  const defaultMdPath = `reports/stress_rag_${timestamp}.md`;

  const writtenJson = writeJsonReport(defaultJsonPath, report);
  if (writtenJson) {
    try {
      const markdown = buildMarkdown(report);
      fs.writeFileSync(path.resolve(process.cwd(), defaultMdPath), markdown, 'utf8');
      console.log(`\nRelatórios gerados com sucesso:`);
      console.log(`  - JSON: ${defaultJsonPath}`);
      console.log(`  - MD:   ${defaultMdPath}`);
    } catch (err) {
      console.warn(`[AVISO] Não foi possível salvar relatório MD em ${defaultMdPath}: ${err.message}`);
    }
  }

  if (args.output && args.output !== defaultJsonPath) {
    writeJsonReport(args.output, report);
  }

  if (summary.dangerousCount > 0 || summary.p95 > 10000 || summary.errorRate > 0.02) {
    console.error('\n❌ Execução REJEITADA: Limites de segurança ou SLA violados. Gate M3 bloqueado.');
    process.exit(1);
  } else if (summary.inconclusiveQueries > 0) {
    console.warn('\n⚠️ Execução INCONCLUSIVA: Variações textuais detectadas. Requer homologação do P.O.');
    process.exit(0);
  } else {
    console.log('\n✅ Execução APROVADA: Todos os critérios satisfeitos.');
    process.exit(0);
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Erro crítico no simulador: ${error.message}`);
    process.exit(1);
  });
}

module.exports = {
  parseArgs,
  selectScenarios,
  runSequentialScenarios,
};
