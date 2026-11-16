const fs = require('node:fs');
const path = require('node:path');

const { argumentValue } = require('./cli-utils');
const {
  BlindValidationError,
  ROUND_ID_PATTERN,
} = require('../services/blindValidationExecutionService');
const {
  compareValidationRounds,
  recordPoDecision,
  renderPoDecisionMarkdown,
  renderRoundsComparisonMarkdown,
  writeBlindValidationDecision,
} = require('../services/blindValidationDecisionService');

const DATA_DIR = path.join(__dirname, '..', 'data', 'blind-validation');
const DEFAULT_REPORTS_ROOT = path.join(__dirname, '..', '..', '..', 'docs', 'riscos', 'validacao-cega');

function readJson(filePath, label) {
  if (!fs.existsSync(filePath)) {
    throw new BlindValidationError('FILE_NOT_FOUND', `${label} não encontrado em ${filePath}.`);
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function main() {
  const roundId = argumentValue('--round');
  const decisionInputPath = argumentValue('--decision');
  if (!roundId || !ROUND_ID_PATTERN.test(roundId)) {
    throw new BlindValidationError('INVALID_ROUND_ID', 'Informe --round=<id> válido.');
  }
  if (!decisionInputPath) {
    throw new BlindValidationError('INVALID_ARGS', 'Informe --decision=<caminho-json>.');
  }

  const previousRoundId = argumentValue('--previous-round');
  if (previousRoundId && !ROUND_ID_PATTERN.test(previousRoundId)) {
    throw new BlindValidationError('INVALID_ROUND_ID', 'Informe --previous-round=<id> válido.');
  }

  const runsDir = argumentValue('--runs-dir') || path.join(DATA_DIR, 'runs');
  const reportsRootDir = argumentValue('--reports-root') || DEFAULT_REPORTS_ROOT;
  const reportsDir = argumentValue('--reports-dir') || path.join(reportsRootDir, 'runs');

  const roundDir = path.join(runsDir, roundId);
  const reportDir = path.join(reportsDir, roundId);

  const comparison = readJson(path.join(roundDir, 'comparison.json'), 'Comparação da rodada');
  const input = readJson(decisionInputPath, 'Arquivo de decisão do P.O.');

  const decision = recordPoDecision({
    comparison,
    roundStatus: input.roundStatus,
    approver: input.approver,
    decidedAt: input.decidedAt,
    divergenceDecisions: input.divergenceDecisions,
    exceptionJustification: input.exceptionJustification,
  });

  let roundsDiffMarkdown = null;
  if (previousRoundId) {
    const previousComparison = readJson(
      path.join(runsDir, previousRoundId, 'comparison.json'),
      'Comparação da rodada anterior'
    );
    const diff = compareValidationRounds({ previousComparison, currentComparison: comparison });
    roundsDiffMarkdown = renderRoundsComparisonMarkdown(diff);
  }

  const decisionMarkdown = renderPoDecisionMarkdown(decision);
  const paths = writeBlindValidationDecision({
    roundDir,
    reportDir,
    decision,
    decisionMarkdown,
    reportsRootDir,
    roundsDiffMarkdown,
  });

  console.log(JSON.stringify({
    roundId: decision.roundId,
    roundStatus: decision.roundStatus,
    requiresRerun: decision.requiresRerun,
    canCloseParentIssue: decision.canCloseParentIssue,
    ...paths,
  }, null, 2));
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(JSON.stringify({
      error: error.code || 'BLIND_VALIDATION_DECIDE_FAILED',
      message: error.message,
      details: error.details || {},
    }));
    process.exit(1);
  }
}

module.exports = { main };
