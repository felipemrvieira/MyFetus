const fs = require('node:fs');
const path = require('node:path');

const { argumentValue } = require('./cli-utils');
const { DEFAULT_CATALOG_PATH } = require('../services/riskEngine');
const {
  BlindValidationError,
  DEFAULT_ENGINE_PATH,
  executeBlindValidationRound,
  verifyBlindValidationRound,
  writeBlindValidationRound,
} = require('../services/blindValidationExecutionService');

const DATA_DIR = path.join(__dirname, '..', 'data', 'blind-validation');

function readJson(filePath, label) {
  if (!fs.existsSync(filePath)) {
    throw new BlindValidationError('FILE_NOT_FOUND', `${label} não encontrado em ${filePath}.`);
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function main() {
  const roundId = argumentValue('--round');
  const verifyRoundId = argumentValue('--verify-round');
  if (!roundId && !verifyRoundId || roundId && verifyRoundId) {
    throw new BlindValidationError(
      'INVALID_ARGS',
      'Informe exatamente --round=<id> ou --verify-round=<id>.'
    );
  }

  const casesPath = argumentValue('--cases') || path.join(DATA_DIR, 'cases.v1.json');
  const gabaritoPath = argumentValue('--gabarito') || path.join(DATA_DIR, 'gabarito.v1.json');
  const outDir = argumentValue('--out-dir') || path.join(DATA_DIR, 'runs');
  const catalogPath = argumentValue('--catalog') || DEFAULT_CATALOG_PATH;
  const enginePath = argumentValue('--engine') || DEFAULT_ENGINE_PATH;

  const dataset = readJson(casesPath, 'Dataset de casos');
  const gabarito = readJson(gabaritoPath, 'Gabarito clínico');

  if (verifyRoundId) {
    const result = verifyBlindValidationRound({
      roundDir: path.join(outDir, verifyRoundId),
      dataset,
      gabarito,
      catalogPath,
      enginePath,
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const execution = executeBlindValidationRound({
    roundId,
    dataset,
    gabarito,
    catalogPath,
    enginePath,
  });
  const outputPath = writeBlindValidationRound({ outDir, execution });
  console.log(JSON.stringify({
    status: 'recorded',
    roundId: execution.roundId,
    outputPath,
    deterministicDigest: execution.deterministicDigest,
    summary: execution.summary,
  }, null, 2));
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(JSON.stringify({
      error: error.code || 'BLIND_VALIDATION_FAILED',
      message: error.message,
      details: error.details || {},
    }));
    process.exit(1);
  }
}

module.exports = { main };
