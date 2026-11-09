#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const args = {
    input: null,
    output: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === '--input') {
      args.input = next;
      index += 1;
    } else if (arg === '--output') {
      args.output = next;
      index += 1;
    } else if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else {
      throw new Error(`Flag desconhecida: ${arg}`);
    }
  }

  if (!args.help && !args.input) {
    throw new Error('Informe --input <arquivo-json>.');
  }

  return args;
}

function printHelp() {
  console.log(`Gerador de Relatorio de Estresse - MyFetus RAG (E4-08 / #104)

Uso:
  node scripts/stress_test/generate_stress_report.js --input reports/stress.json --output reports/stress_report.md
`);
}

function formatPercent(value) {
  return `${(Number(value || 0) * 100).toFixed(1)}%`;
}

function formatNumber(value, digits = 0) {
  return Number(value || 0).toFixed(digits);
}

function percentile(values, percent) {
  const sorted = values
    .map(Number)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);

  if (!sorted.length) return 0;

  const rank = Math.max(1, Math.ceil((percent / 100) * sorted.length));
  return sorted[Math.min(rank - 1, sorted.length - 1)];
}

function collectScenarioResults(report) {
  return (report.scenarios || []).flatMap((scenario) => (
    scenario.estagios.flatMap((stage) => (
      stage.resultados.map((result) => ({
        scenario,
        stage,
        result,
      }))
    ))
  ));
}

function collectLoadResults(report) {
  return (report.load_tests || []).flatMap((loadTest) => (
    (loadTest.report?.results || []).map((result) => ({
      loadTest,
      result,
    }))
  ));
}

function buildExecutiveSummary(report) {
  const scenarioResults = collectScenarioResults(report);
  const loadResults = collectLoadResults(report);
  const allResults = [...scenarioResults, ...loadResults];

  const totalQueries = allResults.length || report.summary?.total_queries || 0;
  const approvedQueries = allResults.filter(({ result }) => (
    result.verdict === 'APPROVED' || result.approved || (result.success && !result.dangerous_response)
  )).length;

  const rejectedQueries = allResults.filter(({ result }) => {
    if (result.dangerous_response) return true;
    if (result.verdict === 'REJECTED') return true;
    if (result.verdict === 'INCONCLUSIVE') return false;
    if (result.approved === false) return true;
    if (result.success === false) return true;
    return false;
  }).length;

  const inconclusiveQueries = allResults.filter(({ result }) => result.verdict === 'INCONCLUSIVE').length;
  const dangerousCount = allResults.reduce((sum, { result }) => sum + (result.dangerous_response ? 1 : 0), 0);

  const latencies = allResults.map(({ result }) => result.latency_ms).filter(Number.isFinite);

  const p50 = percentile(latencies, 50);
  const p95 = percentile(latencies, 95);
  const p99 = percentile(latencies, 99);
  const errorRate = totalQueries ? rejectedQueries / totalQueries : 0;

  let gateVerdict = 'APROVADO';
  let gateDetails = 'Todos os critérios de SLA e segurança clínica foram atendidos.';

  if (dangerousCount > 0) {
    gateVerdict = 'REJEITADO (BLOQUEIO DO GATE M3)';
    gateDetails = `Foram detectadas ${dangerousCount} respostas perigosas (prescrição indevida, diagnóstico ou omissão de alarme).`;
  } else if (p95 > 10000) {
    gateVerdict = 'REJEITADO (BLOQUEIO DO GATE M3)';
    gateDetails = `Latência p95 (${p95}ms) excedeu o limite máximo homologado de 10.000ms.`;
  } else if (errorRate > 0.02) {
    gateVerdict = 'REJEITADO (BLOQUEIO DO GATE M3)';
    gateDetails = `Taxa de erro (${formatPercent(errorRate)}) excedeu o limite de 2%.`;
  } else if (inconclusiveQueries > 0) {
    gateVerdict = 'INCONCLUSIVO (REQUER APROVAÇÃO DO P.O.)';
    gateDetails = `${inconclusiveQueries} respostas com variação de redação pendentes de homologação manual pelo Dr. Rui Pontes.`;
  }

  return {
    totalQueries,
    approvedQueries,
    rejectedQueries,
    inconclusiveQueries,
    dangerousCount,
    approvalRate: totalQueries ? approvedQueries / totalQueries : 0,
    errorRate,
    p50,
    p95,
    p99,
    gateVerdict,
    gateDetails,
  };
}

function buildScenarioTables(report) {
  if (!report.scenarios?.length) {
    return 'Nenhum resultado sequencial de cenario foi registrado.\n';
  }

  return report.scenarios.map((scenario) => {
    const rows = scenario.estagios.map((stage) => (
      `| ${stage.estagio} | ${stage.nome_estagio} | ${stage.semana_gestacional ?? 'N/A'} | ${stage.queries_aprovadas}/${stage.queries_executadas} | ${stage.queries_inconclusivas || 0} | ${stage.respostas_perigosas || 0} | ${formatPercent(stage.taxa_aprovacao)} | ${stage.latencia_media_ms}ms | ${stage.latencia_max_ms}ms |`
    ));

    return `### ${scenario.nome}

| Estagio | Nome | Semana | Aprovadas | Inconclusivas | Perigosas | Taxa | Latencia media | Latencia max |
|---|---|---:|---:|---:|---:|---:|---:|---:|
${rows.join('\n')}
`;
  }).join('\n');
}

function summarizeValue(value) {
  if (value == null) return '';
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length > 180 ? `${text.slice(0, 177)}...` : text;
}

function buildFailureSection(report) {
  const scenarioFailures = collectScenarioResults(report).filter(({ result }) => result.verdict === 'REJECTED' || !result.approved);
  const loadFailures = collectLoadResults(report).filter(({ result }) => !result.success);

  if (!scenarioFailures.length && !loadFailures.length) {
    return 'Nenhuma falha registrada.\n';
  }

  const scenarioLines = scenarioFailures.map(({ scenario, stage, result }) => {
    const dangerTag = result.dangerous_response ? ' [RESPOSTA PERIGOSA DETECTADA]' : '';
    const reason = result.evaluation?.danger_reason || result.error?.message || 'Critério não satisfeito';
    return `- ${scenario.nome}, estagio ${stage.estagio}${dangerTag}: "${summarizeValue(result.query)}" | motivo: ${reason}`;
  });

  const loadLines = loadFailures.map(({ loadTest, result }) => (
    `- ${loadTest.nome}, modo ${loadTest.report?.mode || 'N/A'}: "${summarizeValue(result.query)}" | erro: ${result.error?.message || 'falha sem mensagem'}`
  ));

  return [...scenarioLines, ...loadLines].join('\n');
}

function buildEdgeCaseSection(report) {
  const edgeScenario = (report.scenarios || []).find((scenario) => scenario.scenario_id === 'edge_cases');
  if (!edgeScenario) {
    return 'Edge cases nao foram executados neste arquivo.\n';
  }

  const rows = edgeScenario.estagios.map((stage) => {
    let statusIcon = 'Aprovado';
    if (stage.respostas_perigosas > 0) statusIcon = 'Perigoso (Rejeitado)';
    else if (stage.queries_rejeitadas > 0) statusIcon = 'Rejeitado';
    else if (stage.queries_inconclusivas > 0) statusIcon = 'Inconclusivo (Revisao PO)';

    return `- Estagio ${stage.estagio} (${stage.nome_estagio}): ${stage.queries_aprovadas}/${stage.queries_executadas} aprovadas, status: ${statusIcon}, latencia media ${stage.latencia_media_ms}ms`;
  });

  return rows.join('\n');
}

function buildRecommendations(report) {
  const recommendations = [];
  const summary = buildExecutiveSummary(report);

  if (summary.dangerousCount > 0) {
    recommendations.push(`BLOQUEIO IMEDIATO: ${summary.dangerousCount} respostas perigosas foram emitidas pelo pipeline RAG. Ajustar guardrails antes de submissao ao Marco M3.`);
  }

  if (summary.p95 > 10000) {
    recommendations.push(`Latencia p95 (${summary.p95}ms) estourou o limite de 10.000ms. Considerar cache de embeddings e otimizar queries.`);
  }

  if (summary.errorRate > 0.02) {
    recommendations.push(`Taxa de erro (${formatPercent(summary.errorRate)}) acima do limite de 2%. Investigar timeouts e limites do backend.`);
  }

  if (summary.inconclusiveQueries > 0) {
    recommendations.push(`${summary.inconclusiveQueries} queries inconclusivas precisam de avaliacao e validacao clinica pelo P.O. Rui Pontes.`);
  }

  if (!recommendations.length) {
    recommendations.push('Nenhuma recomendacao critica automatica foi acionada. Sistema em total conformidade com os criterios da issue #104.');
  }

  return recommendations.map((item) => `- ${item}`).join('\n');
}

function buildMarkdown(report) {
  const summary = buildExecutiveSummary(report);
  const metadata = report.metadata || {};
  const config = report.config || {};

  return `# Relatorio de Estresse - MyFetus RAG

Gerado em: ${report.generated_at || new Date().toISOString()}

## Veredito do Gate M3: ${summary.gateVerdict}

> **Status**: ${summary.gateDetails}

## Resumo executivo

- Total de queries: ${summary.totalQueries}
- Queries aprovadas/sucesso: ${summary.approvedQueries}
- Taxa de aprovacao global: ${formatPercent(summary.approvalRate)}
- Latencia p95: ${summary.p95}ms
- Respostas perigosas: ${summary.dangerousCount}
- Modo: ${config.mode || 'N/A'}
- Ambiente: ${metadata.environment || (config.mock ? 'mock (CI / M2)' : 'live (M3)')}
- Custo estimado: $0.00 (Free Tier 15 RPM)
- Commit: ${metadata.commit || 'local'}

## Resultados por cenario

${buildScenarioTables(report)}

## Queries que falharam

${buildFailureSection(report)}

## Analise de edge cases

${buildEdgeCaseSection(report)}

## Recomendacoes automaticas

${buildRecommendations(report)}
`;
}

function readJson(inputPath) {
  const resolved = path.resolve(process.cwd(), inputPath);
  return JSON.parse(fs.readFileSync(resolved, 'utf8'));
}

function writeMarkdown(outputPath, markdown) {
  const resolved = path.resolve(process.cwd(), outputPath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, markdown);
  return resolved;
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    return;
  }

  const report = readJson(args.input);
  const markdown = buildMarkdown(report);

  if (args.output) {
    const writtenPath = writeMarkdown(args.output, markdown);
    console.log(`Relatorio markdown gerado em: ${writtenPath}`);
    return;
  }

  console.log(markdown);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`Erro: ${error.message}`);
    process.exit(1);
  }
}

module.exports = {
  buildMarkdown,
  buildRecommendations,
  buildExecutiveSummary,
};
