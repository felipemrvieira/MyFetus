const fs = require('node:fs');
const path = require('node:path');

const {
  BlindValidationError,
  ROUND_ID_PATTERN,
  validateFilledGabarito,
} = require('./blindValidationExecutionService');
const { loadCatalog } = require('./riskEngine');

const SEVERITY_ORDER = { verde: 0, amarelo: 1, vermelho: 2 };
const EXPECTED_SEVERITIES = ['verde', 'amarelo', 'vermelho'];

function classifyCaseOutcome(expected, motor) {
  if (expected.classificacao === 'inconclusivo') {
    return { outcome: 'inconclusivo', concordant: null, severityDelta: null };
  }
  if (expected.classificacao === 'vermelho' && motor.severidade !== 'vermelho') {
    return {
      outcome: 'falso_negativo_critico',
      concordant: false,
      severityDelta: `${expected.classificacao}->${motor.severidade}`,
    };
  }
  if (expected.classificacao === 'amarelo' && motor.severidade === 'verde') {
    return {
      outcome: 'falso_negativo_nao_critico',
      concordant: false,
      severityDelta: 'amarelo->verde',
    };
  }
  if (SEVERITY_ORDER[motor.severidade] > SEVERITY_ORDER[expected.classificacao]) {
    return {
      outcome: 'falso_positivo',
      concordant: false,
      severityDelta: `${expected.classificacao}->${motor.severidade}`,
    };
  }
  if (motor.faltamDados !== expected.faltamDados) {
    return {
      outcome: 'divergencia_pendencia_dados',
      concordant: false,
      severityDelta: `${expected.classificacao}->${motor.severidade}`,
    };
  }
  return { outcome: 'concordante', concordant: true, severityDelta: null };
}

function buildBreakdown(items, keys) {
  const result = {};
  for (const key of keys) {
    const subset = items.filter((item) => item.groupKey === key);
    const conclusive = subset.filter((item) => item.outcome !== 'inconclusivo');
    const concordant = conclusive.filter((item) => item.concordant === true).length;
    result[key] = {
      total: subset.length,
      conclusive: conclusive.length,
      inconclusive: subset.length - conclusive.length,
      concordant,
      divergent: conclusive.length - concordant,
      concordanceRate: conclusive.length > 0 ? Number((concordant / conclusive.length).toFixed(4)) : null,
    };
  }
  return result;
}

function validateComparisonInputs(execution, gabarito, coverage) {
  if (!execution || !Array.isArray(execution.cases)) {
    throw new BlindValidationError('INVALID_EXECUTION', 'Arquivo de execução inválido.');
  }
  if (typeof execution.roundId !== 'string' || !ROUND_ID_PATTERN.test(execution.roundId)) {
    throw new BlindValidationError('INVALID_ROUND_ID', `Identificador de rodada inválido: ${execution.roundId}`);
  }
  if (execution.summary?.technicalErrorCount > 0 || execution.cases.some((c) => c.executionStatus !== 'ok')) {
    throw new BlindValidationError(
      'TECHNICAL_ERRORS_PRESENT',
      'Não é possível comparar rodada com falhas técnicas de execução.'
    );
  }
  validateFilledGabarito(gabarito, execution);
  if (!coverage || !Array.isArray(coverage.cases)) {
    throw new BlindValidationError('INVALID_COVERAGE', 'Matriz de cobertura inválida.');
  }
}

/**
 * Compara a saída cega do motor com o gabarito clínico fechado e calcula métricas da E3-09.3.
 */
function compareBlindValidationRound({
  execution,
  gabarito,
  coverage,
  targetConcordance = 0.9,
  minConclusiveCases = 18,
  maxInconclusiveCases = 2,
  comparedAt = new Date().toISOString(),
}) {
  validateComparisonInputs(execution, gabarito, coverage);

  const gabaritoById = new Map(gabarito.cases.map((c) => [c.id, c]));
  const coverageById = new Map(coverage.cases.map((c) => [c.id, c]));
  const ruleToCategory = new Map(
    loadCatalog().categories.flatMap((cat) => cat.rules.map((rule) => [rule.id, cat.id]))
  );

  const cases = execution.cases.map((execCase) => {
    const expected = gabaritoById.get(execCase.id);
    const cov = coverageById.get(execCase.id);
    if (!cov) {
      throw new BlindValidationError('INVALID_COVERAGE', `Caso ${execCase.id} ausente na matriz de cobertura.`);
    }

    const motor = execCase.clinicalResult;
    const classification = classifyCaseOutcome(expected, motor);
    const targetCategories = (cov.targets || [])
      .map((t) => t.category || ruleToCategory.get(t.ruleId))
      .filter(Boolean);
    const clinicalCategories = [...new Set([
      ...motor.regrasAcionadas.map((r) => r.category),
      ...motor.pendingCategories.map((p) => p.category),
      ...targetCategories,
    ])];

    return {
      id: execCase.id,
      caseType: cov.type,
      targets: cov.targets || [],
      expected: {
        classificacao: expected.classificacao,
        faltamDados: expected.faltamDados,
        justificativa: expected.justificativa,
      },
      motor: {
        severidade: motor.severidade,
        triagem: motor.triagem,
        faltamDados: motor.faltamDados,
        regrasAcionadas: motor.regrasAcionadas.map((r) => r.ruleId),
        justificativa: motor.justificativa,
      },
      clinicalCategories,
      ...classification,
    };
  });

  const conclusive = cases.filter((c) => c.outcome !== 'inconclusivo');
  const inconclusiveCases = cases.length - conclusive.length;
  const concordantCases = conclusive.filter((c) => c.concordant === true).length;
  const rawConcordanceRate = conclusive.length > 0 ? concordantCases / conclusive.length : 0;
  const concordanceRate = Number(rawConcordanceRate.toFixed(4));

  const divergenceSummary = {
    falso_negativo_critico: cases.filter((c) => c.outcome === 'falso_negativo_critico').length,
    falso_negativo_nao_critico: cases.filter((c) => c.outcome === 'falso_negativo_nao_critico').length,
    falso_positivo: cases.filter((c) => c.outcome === 'falso_positivo').length,
    divergencia_pendencia_dados: cases.filter((c) => c.outcome === 'divergencia_pendencia_dados').length,
  };

  const invalidReasons = [];
  if (inconclusiveCases > maxInconclusiveCases) {
    invalidReasons.push(`Quantidade de inconclusivos (${inconclusiveCases}) excede o máximo permitido (${maxInconclusiveCases}).`);
  }
  if (conclusive.length < minConclusiveCases) {
    invalidReasons.push(`Quantidade de casos conclusivos (${conclusive.length}) inferior ao mínimo (${minConclusiveCases}).`);
  }

  const valid = invalidReasons.length === 0;
  const meetsTarget = valid && rawConcordanceRate >= targetConcordance;
  const blocked = !valid || divergenceSummary.falso_negativo_critico > 0;

  const caseTypeKeys = [...new Set(cases.map((c) => c.caseType))];
  const byCaseType = buildBreakdown(cases.map((c) => ({ ...c, groupKey: c.caseType })), caseTypeKeys);
  const byExpectedSeverity = buildBreakdown(
    conclusive.map((c) => ({ ...c, groupKey: c.expected.classificacao })),
    EXPECTED_SEVERITIES
  );
  const byRule = buildRuleBreakdown(cases);

  return {
    roundId: execution.roundId,
    datasetId: execution.datasetId,
    datasetVersion: execution.datasetVersion,
    comparedAt,
    evaluator: gabarito.evaluator,
    filledAt: gabarito.filledAt,
    frozen: execution.frozen,
    global: {
      totalCases: cases.length,
      conclusiveCases: conclusive.length,
      inconclusiveCases,
      concordantCases,
      divergentCases: conclusive.length - concordantCases,
      concordanceRate,
      targetRate: targetConcordance,
      meetsTarget,
    },
    divergenceSummary,
    roundStatus: {
      valid,
      invalidReason: invalidReasons.length > 0 ? invalidReasons.join(' ') : null,
      blocked,
      approvedForTarget: valid && meetsTarget && divergenceSummary.falso_negativo_critico === 0,
    },
    byCaseType,
    byExpectedSeverity,
    byRule,
    cases,
  };
}

function buildRuleBreakdown(cases) {
  const byRule = {};
  for (const item of cases) {
    const ruleIds = [...new Set([
      ...(item.targets || []).map((t) => t.ruleId),
      ...item.motor.regrasAcionadas,
    ])];
    for (const ruleId of ruleIds) {
      if (!byRule[ruleId]) {
        byRule[ruleId] = { targeted: 0, triggered: 0, concordant: 0, divergent: 0 };
      }
      if ((item.targets || []).some((t) => t.ruleId === ruleId)) byRule[ruleId].targeted += 1;
      if (item.motor.regrasAcionadas.includes(ruleId)) byRule[ruleId].triggered += 1;
      if (item.concordant === true) byRule[ruleId].concordant += 1;
      else if (item.concordant === false) byRule[ruleId].divergent += 1;
    }
  }
  return byRule;
}

function formatPercent(rate) {
  if (rate === null || rate === undefined) return 'N/A';
  return `${(rate * 100).toFixed(1)}%`;
}

function renderBreakdownTable(title, columnLabel, breakdown) {
  const lines = [
    `## ${title}`,
    '',
    `| ${columnLabel} | Total | Conclusivos | Concordantes | Divergentes | Concordância |`,
    '| --- | ---: | ---: | ---: | ---: | ---: |',
  ];
  for (const [key, stats] of Object.entries(breakdown)) {
    lines.push(
      `| ${key} | ${stats.total} | ${stats.conclusive} | ${stats.concordant} | ${stats.divergent} | ${formatPercent(stats.concordanceRate)} |`
    );
  }
  lines.push('');
  return lines;
}

/**
 * Renderiza o relatório de concordância da rodada em Markdown (sem dados reais de pacientes).
 */
function renderComparisonReportMarkdown(comparison) {
  const { global, divergenceSummary, roundStatus, frozen } = comparison;
  const statusLabel = !roundStatus.valid
    ? 'RODADA INVÁLIDA'
    : divergenceSummary.falso_negativo_critico > 0
      ? 'BLOQUEADA POR FALSO NEGATIVO CRÍTICO'
      : global.meetsTarget
        ? 'APROVADA PARA META'
        : 'ABAIXO DA META';

  const lines = [
    `# Relatório de Concordância — Rodada \`${comparison.roundId}\``,
    '',
    '> **Aviso de privacidade e escopo:** Relatório gerado exclusivamente sobre casos 100% sintéticos, sem dados reais de pacientes. Avalia o escopo congelado do motor (`riskEngine.js` + `alert-rules.json`).',
    '',
    '## Metadados e Versões Congeladas',
    '',
    `- **Dataset:** \`${comparison.datasetId}\` v\`${comparison.datasetVersion}\``,
    `- **Catálogo:** v\`${frozen.catalogVersion}\` (SHA-256 \`${frozen.catalogSha256}\`)`,
    `- **Motor SHA-256:** \`${frozen.engineSha256}\``,
    `- **Commit:** \`${frozen.gitCommit}\``,
    `- **Avaliador clínico:** ${comparison.evaluator} (fechado em ${comparison.filledAt})`,
    `- **Comparado em:** ${comparison.comparedAt}`,
    '',
    '## Resultado Global e Meta',
    '',
    `- **Status da rodada:** **${statusLabel}**`,
    `- **Meta de concordância:** >= ${(global.targetRate * 100).toFixed(0)}%`,
    `- **Concordância obtida:** **${formatPercent(global.concordanceRate)}** (${global.concordantCases}/${global.conclusiveCases} conclusivos; ${global.inconclusiveCases} inconclusivos)`,
    `- **Falso negativo crítico (BLOQUEADOR):** ${divergenceSummary.falso_negativo_critico}`,
    `- **Falso negativo não crítico:** ${divergenceSummary.falso_negativo_nao_critico}`,
    `- **Falso positivo:** ${divergenceSummary.falso_positivo}`,
    `- **Divergência de pendência de dados:** ${divergenceSummary.divergencia_pendencia_dados}`,
    '',
  ];

  if (roundStatus.invalidReason) {
    lines.push(`> **Motivo de invalidade:** ${roundStatus.invalidReason}`, '');
  }

  lines.push(...renderBreakdownTable('Concordância por Tipo de Caso do Protocolo', 'Tipo de Caso', comparison.byCaseType));
  lines.push(...renderBreakdownTable('Concordância por Gravidade Esperada', 'Gravidade Esperada', comparison.byExpectedSeverity));

  const divergences = comparison.cases.filter((c) => c.concordant === false);
  lines.push('## Divergências Detalhadas', '');
  if (divergences.length === 0) {
    lines.push('Nenhuma divergência registrada.', '');
  } else {
    for (const item of divergences) {
      lines.push(
        `### ${item.id} (${item.outcome}) — tipo \`${item.caseType}\``,
        `- **Esperado (gabarito):** \`${item.expected.classificacao}\` | \`faltamDados=${item.expected.faltamDados}\` — ${item.expected.justificativa || 'sem justificativa'}`,
        `- **Motor:** \`${item.motor.severidade}\` (\`${item.motor.triagem}\`) | \`faltamDados=${item.motor.faltamDados}\` — ${item.motor.justificativa}`,
        `- **Categorias clínicas envolvidas:** ${item.clinicalCategories.join(', ') || 'nenhuma'}`,
        `- **Regras acionadas:** ${item.motor.regrasAcionadas.join(', ') || 'nenhuma'}`,
        ''
      );
    }
  }

  const inconclusives = comparison.cases.filter((c) => c.outcome === 'inconclusivo');
  lines.push('## Casos Inconclusivos', '');
  if (inconclusives.length === 0) {
    lines.push('Nenhum caso inconclusivo.', '');
  } else {
    for (const item of inconclusives) {
      lines.push(`- **${item.id}** (\`${item.caseType}\`): ${item.expected.justificativa}`);
    }
    lines.push('');
  }

  return `${lines.join('\n')}\n`;
}

/**
 * Grava comparison.json e relatorio-concordancia.md em modo append-only.
 */
function writeBlindValidationComparison({ roundDir, reportDir, comparison, markdown }) {
  if (!roundDir || typeof roundDir !== 'string' || !reportDir || typeof reportDir !== 'string') {
    throw new BlindValidationError('INVALID_OUTPUT_DIR', 'Diretório de saída inválido.');
  }
  const comparisonPath = path.join(roundDir, 'comparison.json');
  const reportPath = path.join(reportDir, 'relatorio-concordancia.md');
  if (fs.existsSync(comparisonPath) || fs.existsSync(reportPath)) {
    throw new BlindValidationError(
      'ROUND_ALREADY_EXISTS',
      `Comparação da rodada ${comparison.roundId} já foi gravada e não pode ser sobrescrita.`
    );
  }
  fs.mkdirSync(roundDir, { recursive: true });
  fs.mkdirSync(reportDir, { recursive: true });
  fs.writeFileSync(comparisonPath, `${JSON.stringify(comparison, null, 2)}\n`, 'utf8');
  fs.writeFileSync(reportPath, markdown, 'utf8');
  return { comparisonPath, reportPath };
}

module.exports = {
  compareBlindValidationRound,
  renderComparisonReportMarkdown,
  writeBlindValidationComparison,
};
