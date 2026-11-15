const fs = require('node:fs');
const path = require('node:path');

const {
  BlindValidationError,
  ROUND_ID_PATTERN,
} = require('./blindValidationExecutionService');

const ALLOWED_ROUND_STATUSES = new Set(['aprovado', 'corrigir', 'inconclusivo']);
const ALLOWED_ACTIONS = new Set([
  'ajustar_regra',
  'ajustar_limiar',
  'ajustar_severidade',
  'nova_regra',
  'remover_regra',
  'manter_motor',
  'revisar_caso',
]);
const RERUN_ACTIONS = new Set([
  'ajustar_regra',
  'ajustar_limiar',
  'ajustar_severidade',
  'nova_regra',
  'remover_regra',
  'revisar_caso',
]);

function validateApprovalGates(comparison, roundStatus, exceptionJustification) {
  if (roundStatus !== 'aprovado') return;

  if (comparison.divergenceSummary?.falso_negativo_critico > 0) {
    throw new BlindValidationError(
      'APPROVAL_BLOCKED',
      'Não é permitido aprovar rodada com falso negativo crítico.'
    );
  }
  if (!comparison.roundStatus?.valid) {
    throw new BlindValidationError(
      'APPROVAL_BLOCKED',
      `Não é permitido aprovar rodada inválida: ${comparison.roundStatus?.invalidReason || ''}`.trim()
    );
  }
  if (!comparison.global?.meetsTarget && (typeof exceptionJustification !== 'string' || !exceptionJustification.trim())) {
    throw new BlindValidationError(
      'APPROVAL_BLOCKED',
      'Concordância abaixo de 90% exige exceptionJustification formal para aprovação.'
    );
  }
}

function normalizeCaseDecisions(comparison, divergenceDecisions) {
  if (!Array.isArray(divergenceDecisions)) {
    throw new BlindValidationError('INVALID_DECISION', 'divergenceDecisions deve ser uma lista.');
  }
  const requiredIds = new Set(
    comparison.cases
      .filter((c) => c.concordant === false || c.outcome === 'inconclusivo')
      .map((c) => c.id)
  );
  const allIds = new Set(comparison.cases.map((c) => c.id));
  const seen = new Set();

  const normalized = divergenceDecisions.map((entry) => {
    if (!entry || typeof entry.caseId !== 'string' || !allIds.has(entry.caseId)) {
      throw new BlindValidationError('INVALID_DECISION', `Caso inválido na decisão: ${entry?.caseId}`);
    }
    if (seen.has(entry.caseId)) {
      throw new BlindValidationError('INVALID_DECISION', `Decisão duplicada para ${entry.caseId}.`);
    }
    seen.add(entry.caseId);

    if (!ALLOWED_ACTIONS.has(entry.acao)) {
      throw new BlindValidationError('INVALID_DECISION', `Ação inválida em ${entry.caseId}: ${entry.acao}`);
    }
    if (typeof entry.justificativa !== 'string' || !entry.justificativa.trim()) {
      throw new BlindValidationError('INVALID_DECISION', `Justificativa obrigatória em ${entry.caseId}.`);
    }
    if (typeof entry.responsavel !== 'string' || !entry.responsavel.trim()) {
      throw new BlindValidationError('INVALID_DECISION', `Responsável obrigatório em ${entry.caseId}.`);
    }

    return {
      caseId: entry.caseId,
      acao: entry.acao,
      justificativa: entry.justificativa.trim(),
      responsavel: entry.responsavel.trim(),
    };
  });

  const missingIds = [...requiredIds].filter((id) => !seen.has(id));
  if (missingIds.length > 0) {
    throw new BlindValidationError(
      'MISSING_CASE_DECISION',
      `Faltam decisões para os casos: ${missingIds.join(', ')}.`,
      { missingIds }
    );
  }

  return normalized;
}

/**
 * Registra a deliberação formal do P.O. para uma rodada comparada (E3-09.4).
 */
function recordPoDecision({
  comparison,
  roundStatus,
  approver,
  decidedAt = new Date().toISOString(),
  divergenceDecisions = [],
  exceptionJustification = null,
}) {
  if (!comparison || !Array.isArray(comparison.cases)) {
    throw new BlindValidationError('INVALID_COMPARISON', 'Comparação da rodada ausente ou inválida.');
  }
  if (typeof comparison.roundId !== 'string' || !ROUND_ID_PATTERN.test(comparison.roundId)) {
    throw new BlindValidationError('INVALID_ROUND_ID', `Identificador de rodada inválido: ${comparison.roundId}`);
  }
  if (!ALLOWED_ROUND_STATUSES.has(roundStatus)) {
    throw new BlindValidationError('INVALID_DECISION', `Status de deliberação inválido: ${roundStatus}`);
  }
  if (typeof approver !== 'string' || !approver.trim()) {
    throw new BlindValidationError('INVALID_DECISION', 'approver é obrigatório.');
  }

  validateApprovalGates(comparison, roundStatus, exceptionJustification);
  const normalizedDecisions = normalizeCaseDecisions(comparison, divergenceDecisions);
  const hasRerunAction = normalizedDecisions.some((d) => RERUN_ACTIONS.has(d.acao));
  if (roundStatus === 'aprovado' && hasRerunAction) {
    throw new BlindValidationError(
      'APPROVAL_BLOCKED',
      'Não é permitido aprovar rodada enquanto houver ações que exigem ajuste/reexecução.'
    );
  }
  const requiresRerun = roundStatus === 'corrigir' || hasRerunAction;

  return {
    roundId: comparison.roundId,
    datasetId: comparison.datasetId,
    datasetVersion: comparison.datasetVersion,
    frozen: comparison.frozen,
    roundStatus,
    approver: approver.trim(),
    decidedAt,
    exceptionJustification: exceptionJustification ? exceptionJustification.trim() : null,
    requiresRerun,
    canCloseParentIssue: roundStatus === 'aprovado',
    globalSnapshot: comparison.global,
    divergenceDecisions: normalizedDecisions,
  };
}

function classifyTransition(prevCase, currCase) {
  if (prevCase.concordant === false && currCase.concordant === true) return 'resolvido';
  if (prevCase.concordant === false && currCase.concordant === false) return 'persistente';
  if (prevCase.concordant === true && currCase.concordant === false) return 'regressao';
  if (prevCase.concordant === true && currCase.concordant === true) return 'mantido_concordante';
  return prevCase.outcome === 'inconclusivo' && currCase.outcome === 'inconclusivo'
    ? 'mantido_inconclusivo'
    : 'alterado_inconclusivo';
}

/**
 * Compara duas rodadas consecutivas pareando por caseId, mesmo com alteração de datasetVersion.
 */
function compareValidationRounds({ previousComparison, currentComparison }) {
  if (!previousComparison?.cases || !currentComparison?.cases) {
    throw new BlindValidationError('INVALID_COMPARISON', 'Comparações anterior e atual são obrigatórias.');
  }

  const prevById = new Map(previousComparison.cases.map((c) => [c.id, c]));
  const currById = new Map(currentComparison.cases.map((c) => [c.id, c]));

  const summary = {
    resolvido: [],
    persistente: [],
    regressao: [],
    mantido_concordante: [],
    mantido_inconclusivo: [],
    alterado_inconclusivo: [],
  };

  for (const [id, currCase] of currById.entries()) {
    const prevCase = prevById.get(id);
    if (!prevCase) continue;
    summary[classifyTransition(prevCase, currCase)].push(id);
  }

  const casosAdicionados = [...currById.keys()].filter((id) => !prevById.has(id));
  const casosRemovidos = [...prevById.keys()].filter((id) => !currById.has(id));

  const prevRate = previousComparison.global?.concordanceRate ?? 0;
  const currRate = currentComparison.global?.concordanceRate ?? 0;

  return {
    previousRoundId: previousComparison.roundId,
    currentRoundId: currentComparison.roundId,
    concordanceDelta: Number((currRate - prevRate).toFixed(4)),
    previousConcordanceRate: prevRate,
    currentConcordanceRate: currRate,
    datasetVersionChanged: previousComparison.datasetVersion !== currentComparison.datasetVersion,
    catalogChanged: previousComparison.frozen?.catalogSha256 !== currentComparison.frozen?.catalogSha256,
    engineChanged: previousComparison.frozen?.engineSha256 !== currentComparison.frozen?.engineSha256,
    summary,
    casosAdicionados,
    casosRemovidos,
  };
}

/**
 * Renderiza a deliberação do P.O. em Markdown.
 */
function renderPoDecisionMarkdown(decision) {
  const lines = [
    `# Deliberação do P.O. — Rodada \`${decision.roundId}\``,
    '',
    `- **Status:** \`${decision.roundStatus}\``,
    `- **Responsável pela aprovação:** ${decision.approver}`,
    `- **Data:** ${decision.decidedAt}`,
    `- **Requer nova rodada:** ${decision.requiresRerun ? 'Sim' : 'Não'}`,
    `- **Pode fechar issue-pai (#126):** ${decision.canCloseParentIssue ? 'Sim' : 'Não'}`,
    `- **Concordância da rodada:** ${(decision.globalSnapshot.concordanceRate * 100).toFixed(1)}% (${decision.globalSnapshot.concordantCases}/${decision.globalSnapshot.conclusiveCases})`,
    '',
  ];

  if (decision.exceptionJustification) {
    lines.push(`> **Justificativa formal de exceção:** ${decision.exceptionJustification}`, '');
  }

  lines.push('## Decisões por Caso Divergente / Inconclusivo', '');
  if (decision.divergenceDecisions.length === 0) {
    lines.push('Nenhuma divergência ou caso inconclusivo pendente de decisão.', '');
  } else {
    lines.push('| Caso | Ação | Responsável | Justificativa |', '| --- | --- | --- | --- |');
    for (const item of decision.divergenceDecisions) {
      lines.push(`| ${item.caseId} | \`${item.acao}\` | ${item.responsavel} | ${item.justificativa} |`);
    }
    lines.push('');
  }

  return `${lines.join('\n')}\n`;
}

function formatCaseList(items) {
  return items.length > 0 ? items.join(', ') : 'nenhum';
}

/**
 * Renderiza o comparativo entre duas rodadas consecutivas em Markdown.
 */
function renderRoundsComparisonMarkdown(diff) {
  const lines = [
    `# Comparativo de Rodadas: \`${diff.previousRoundId}\` → \`${diff.currentRoundId}\``,
    '',
    `- **Concordância anterior:** ${(diff.previousConcordanceRate * 100).toFixed(1)}%`,
    `- **Concordância atual:** ${(diff.currentConcordanceRate * 100).toFixed(1)}%`,
    `- **Delta:** ${(diff.concordanceDelta >= 0 ? '+' : '')}${(diff.concordanceDelta * 100).toFixed(1)} p.p.`,
    `- **Dataset alterado:** ${diff.datasetVersionChanged ? 'Sim' : 'Não'}`,
    `- **Catálogo alterado:** ${diff.catalogChanged ? 'Sim' : 'Não'}`,
    `- **Motor alterado:** ${diff.engineChanged ? 'Sim' : 'Não'}`,
    '',
    '## Evolução dos Casos Comuns',
    '',
    `- **Resolvidos (${diff.summary.resolvido.length}):** ${formatCaseList(diff.summary.resolvido)}`,
    `- **Persistentes (${diff.summary.persistente.length}):** ${formatCaseList(diff.summary.persistente)}`,
    `- **Regressões (${diff.summary.regressao.length}):** ${formatCaseList(diff.summary.regressao)}`,
    `- **Mantidos concordantes (${diff.summary.mantido_concordante.length}):** ${formatCaseList(diff.summary.mantido_concordante)}`,
    `- **Mantidos inconclusivos (${diff.summary.mantido_inconclusivo.length}):** ${formatCaseList(diff.summary.mantido_inconclusivo)}`,
    `- **Alterados de/para inconclusivo (${diff.summary.alterado_inconclusivo.length}):** ${formatCaseList(diff.summary.alterado_inconclusivo)}`,
    '',
    '## Alterações de Conjunto',
    '',
    `- **Casos adicionados (${diff.casosAdicionados.length}):** ${formatCaseList(diff.casosAdicionados)}`,
    `- **Casos removidos (${diff.casosRemovidos.length}):** ${formatCaseList(diff.casosRemovidos)}`,
    '',
  ];
  return `${lines.join('\n')}\n`;
}

/**
 * Grava decision.json, decisao-po.md e comparativo-rodadas.md (quando aplicável) em modo append-only.
 */
function writeBlindValidationDecision({
  roundDir,
  reportDir,
  decision,
  decisionMarkdown,
  roundsDiffMarkdown,
}) {
  if (!roundDir || typeof roundDir !== 'string' || !reportDir || typeof reportDir !== 'string') {
    throw new BlindValidationError('INVALID_OUTPUT_DIR', 'Diretório de saída inválido.');
  }
  const decisionPath = path.join(roundDir, 'decision.json');
  const decisionReportPath = path.join(reportDir, 'decisao-po.md');
  const roundsComparisonPath = roundsDiffMarkdown ? path.join(reportDir, 'comparativo-rodadas.md') : null;

  if (
    fs.existsSync(decisionPath)
    || fs.existsSync(decisionReportPath)
    || (roundsComparisonPath && fs.existsSync(roundsComparisonPath))
  ) {
    throw new BlindValidationError(
      'ROUND_ALREADY_EXISTS',
      `Decisão da rodada ${decision.roundId} já foi gravada e não pode ser sobrescrita.`
    );
  }

  fs.mkdirSync(roundDir, { recursive: true });
  fs.mkdirSync(reportDir, { recursive: true });
  fs.writeFileSync(decisionPath, `${JSON.stringify(decision, null, 2)}\n`, 'utf8');
  fs.writeFileSync(decisionReportPath, decisionMarkdown, 'utf8');
  if (roundsComparisonPath) {
    fs.writeFileSync(roundsComparisonPath, roundsDiffMarkdown, 'utf8');
  }

  return { decisionPath, decisionReportPath, roundsComparisonPath };
}

module.exports = {
  compareValidationRounds,
  recordPoDecision,
  renderPoDecisionMarkdown,
  renderRoundsComparisonMarkdown,
  writeBlindValidationDecision,
};
