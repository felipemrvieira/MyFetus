const fs = require('node:fs');
const path = require('node:path');

const { argumentValue } = require('./cli-utils');
const {
  BlindValidationError,
  ROUND_ID_PATTERN,
} = require('../services/blindValidationExecutionService');
const {
  compareBlindValidationRound,
  renderComparisonReportMarkdown,
  writeBlindValidationComparison,
} = require('../services/blindValidationComparisonService');

const DATA_DIR = path.join(__dirname, '..', 'data', 'blind-validation');
const DEFAULT_REPORTS_DIR = path.join(__dirname, '..', '..', '..', 'docs', 'riscos', 'validacao-cega', 'runs');

function readJson(filePath, label) {
  if (!fs.existsSync(filePath)) {
    throw new BlindValidationError('FILE_NOT_FOUND', `${label} não encontrado em ${filePath}.`);
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function main() {
  const roundId = argumentValue('--round');
  if (!roundId || !ROUND_ID_PATTERN.test(roundId)) {
    throw new BlindValidationError('INVALID_ROUND_ID', 'Informe --round=<id> válido.');
  }

  const runsDir = argumentValue('--runs-dir') || path.join(DATA_DIR, 'runs');
  const reportsDir = argumentValue('--reports-dir') || DEFAULT_REPORTS_DIR;
  const gabaritoPath = argumentValue('--gabarito') || path.join(DATA_DIR, 'gabarito.v1.json');
  const coveragePath = argumentValue('--coverage') || path.join(DATA_DIR, 'coverage.v1.json');

  const roundDir = path.join(runsDir, roundId);
  const reportDir = path.join(reportsDir, roundId);

  const execution = readJson(path.join(roundDir, 'execution.json'), 'Execução da rodada');
  const gabarito = readJson(gabaritoPath, 'Gabarito clínico');
  const coverage = readJson(coveragePath, 'Matriz de cobertura');

  const comparison = compareBlindValidationRound({ execution, gabarito, coverage });
  const markdown = renderComparisonReportMarkdown(comparison);
  const paths = writeBlindValidationComparison({ roundDir, reportDir, comparison, markdown });

  console.log(JSON.stringify({
    roundId: comparison.roundId,
    concordanceRate: comparison.global.concordanceRate,
    meetsTarget: comparison.global.meetsTarget,
    blocked: comparison.roundStatus.blocked,
    ...paths,
  }, null, 2));
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(JSON.stringify({
      error: error.code || 'BLIND_VALIDATION_COMPARE_FAILED',
      message: error.message,
      details: error.details || {},
    }));
    process.exit(1);
  }
}

module.exports = { main };
