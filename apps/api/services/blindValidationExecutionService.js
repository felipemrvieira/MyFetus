const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const {
  DEFAULT_CATALOG_PATH,
  evaluateRisk,
  loadCatalog,
} = require('./riskEngine');

const DEFAULT_ENGINE_PATH = path.join(__dirname, 'riskEngine.js');
const SEVERITY_MAP = { green: 'verde', yellow: 'amarelo', red: 'vermelho' };
const TRIAGE_MAP = { green: 'sem_alerta', yellow: 'atencao', red: 'urgente' };
const SEVERITY_RANK = { red: 3, yellow: 2, green: 1 };
const ROUND_ID_PATTERN = /^[a-zA-Z0-9._-]+$/;

const ALLOWED_CLASSIFICATIONS = new Set(['verde', 'amarelo', 'vermelho', 'inconclusivo']);
const FORBIDDEN_ENGINE_KEYS = ['overallSeverity', 'pending_data', 'ruleId', 'categories'];
const PII_PATTERNS = [
  /[\w.+-]+@[\w-]+\.[\w.]+/,
  /\d{3}\.?\d{3}\.?\d{3}-?\d{2}/,
  /\(?\d{2}\)?\s?9?\d{4}-?\d{4}/,
];

class BlindValidationError extends Error {
  /**
   * Erro explícito de contrato, cegamento ou execução na validação cega.
   */
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'BlindValidationError';
    this.code = code;
    this.details = details;
  }
}

function containsPii(raw) {
  return PII_PATTERNS.some((pattern) => pattern.test(raw));
}

/**
 * Valida que o gabarito clínico está fechado, completo e livre de vazamento do motor ou PII.
 */
function validateFilledGabarito(gabarito, dataset) {
  if (!gabarito || typeof gabarito !== 'object' || Array.isArray(gabarito)) {
    throw new BlindValidationError('INVALID_GABARITO', 'Gabarito inválido.');
  }
  if (gabarito.status !== 'preenchido') {
    throw new BlindValidationError(
      'GABARITO_NOT_CLOSED',
      'O gabarito clínico precisa estar fechado (status: "preenchido") antes de executar o motor.',
      { status: gabarito.status }
    );
  }
  if (typeof gabarito.evaluator !== 'string' || !gabarito.evaluator.trim()) {
    throw new BlindValidationError('INVALID_GABARITO', 'Gabarito precisa informar evaluator não vazio.');
  }
  if (typeof gabarito.filledAt !== 'string' || !gabarito.filledAt.trim()) {
    throw new BlindValidationError('INVALID_GABARITO', 'Gabarito precisa informar filledAt válido.');
  }

  const raw = JSON.stringify(gabarito);
  for (const key of FORBIDDEN_ENGINE_KEYS) {
    if (raw.includes(`"${key}"`)) {
      throw new BlindValidationError(
        'BLINDING_VIOLATION',
        `Gabarito não pode conter campo de saída do motor ("${key}").`,
        { key }
      );
    }
  }
  if (containsPii(raw)) {
    throw new BlindValidationError('PII_DETECTED', 'Gabarito contém padrão compatível com dado pessoal.');
  }

  if (!Array.isArray(gabarito.cases) || !dataset || !Array.isArray(dataset.cases)) {
    throw new BlindValidationError('INVALID_GABARITO', 'Lista de casos ausente no gabarito ou no dataset.');
  }

  const expectedIds = dataset.cases.map((item) => item.id);
  const seen = new Set();
  for (const entry of gabarito.cases) {
    if (!entry || typeof entry.id !== 'string' || seen.has(entry.id)) {
      throw new BlindValidationError('INVALID_GABARITO', `Caso duplicado ou sem id no gabarito: ${entry?.id}`);
    }
    seen.add(entry.id);
    if (!ALLOWED_CLASSIFICATIONS.has(entry.classificacao)) {
      throw new BlindValidationError('INVALID_GABARITO', `Classificação inválida em ${entry.id}: ${entry.classificacao}`, {
        caseId: entry.id,
      });
    }
    if (typeof entry.faltamDados !== 'boolean') {
      throw new BlindValidationError('INVALID_GABARITO', `faltamDados deve ser booleano em ${entry.id}.`, {
        caseId: entry.id,
      });
    }
    const needsJustification = entry.classificacao === 'vermelho'
      || entry.classificacao === 'inconclusivo'
      || entry.faltamDados === true;
    if (needsJustification && (typeof entry.justificativa !== 'string' || !entry.justificativa.trim())) {
      throw new BlindValidationError(
        'INVALID_GABARITO',
        `Justificativa obrigatória ausente em ${entry.id}.`,
        { caseId: entry.id }
      );
    }
  }

  const missingIds = expectedIds.filter((id) => !seen.has(id));
  if (missingIds.length > 0 || seen.size !== expectedIds.length) {
    throw new BlindValidationError(
      'INVALID_GABARITO',
      'Os IDs do gabarito não correspondem exatamente aos casos do dataset.',
      { missingIds }
    );
  }

  return true;
}

function sha256NormalizedFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');
  return crypto.createHash('sha256').update(content).digest('hex');
}

function sha256Object(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function resolveGitCommit(cwd = path.join(__dirname, '..', '..', '..')) {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd, encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

function verifyFrozenHashes(dataset, catalog, catalogSha256, engineSha256) {
  if (!dataset.frozen) return;
  if (dataset.frozen.catalogVersion && dataset.frozen.catalogVersion !== catalog.catalogVersion) {
    throw new BlindValidationError(
      'FROZEN_MISMATCH',
      `catalogVersion divergente: esperado ${dataset.frozen.catalogVersion}, atual ${catalog.catalogVersion}.`
    );
  }
  if (dataset.frozen.catalogSha256 && dataset.frozen.catalogSha256 !== catalogSha256) {
    throw new BlindValidationError(
      'FROZEN_MISMATCH',
      'SHA-256 de alert-rules.json diverge da versão congelada no dataset.'
    );
  }
  if (dataset.frozen.engineSha256 && dataset.frozen.engineSha256 !== engineSha256) {
    throw new BlindValidationError(
      'FROZEN_MISMATCH',
      'SHA-256 de riskEngine.js diverge da versão congelada no dataset.'
    );
  }
}

function buildClinicalResult(engineOutput) {
  const pendingCategories = engineOutput.categories
    .filter((cat) => cat.status === 'pending_data')
    .map((cat) => ({
      category: cat.category,
      label: cat.label,
      missingFields: [...cat.missingFields],
    }));

  const regrasAcionadas = engineOutput.categories
    .flatMap((cat) => cat.alerts.map((alert) => ({
      category: cat.category,
      ruleId: alert.ruleId,
      severity: alert.severity,
      evidence: alert.evidence,
      suggestedAction: alert.suggestedAction,
    })))
    .sort((a, b) => (SEVERITY_RANK[b.severity] || 0) - (SEVERITY_RANK[a.severity] || 0));

  const parts = [];
  if (regrasAcionadas.length > 0) {
    parts.push(regrasAcionadas.map((r) => `[${r.ruleId}] ${r.evidence}`).join('; '));
  } else {
    parts.push('Nenhum critério de alerta acionado nas 12 categorias avaliadas.');
  }
  if (pendingCategories.length > 0) {
    const missingDesc = pendingCategories
      .map((p) => `${p.category} (${p.missingFields.join(', ')})`)
      .join('; ');
    parts.push(`Dados obrigatórios ausentes em: ${missingDesc}.`);
  }

  return {
    overallSeverity: engineOutput.overallSeverity,
    severidade: SEVERITY_MAP[engineOutput.overallSeverity],
    triagem: TRIAGE_MAP[engineOutput.overallSeverity],
    faltamDados: pendingCategories.length > 0,
    pendingCategories,
    regrasAcionadas,
    justificativa: parts.join(' '),
  };
}

function resolveEngineModule(enginePath) {
  const resolved = path.resolve(enginePath);
  if (resolved === path.resolve(DEFAULT_ENGINE_PATH)) {
    return { evaluateRisk, loadCatalog };
  }
  return require(resolved);
}

/**
 * Executa o motor de risco às cegas sobre o conjunto validado e separa falhas técnicas.
 */
function executeBlindValidationRound({
  roundId,
  dataset,
  gabarito,
  catalogPath = DEFAULT_CATALOG_PATH,
  enginePath = DEFAULT_ENGINE_PATH,
  commitSha,
  executedAt = new Date().toISOString(),
}) {
  if (typeof roundId !== 'string' || !ROUND_ID_PATTERN.test(roundId)) {
    throw new BlindValidationError('INVALID_ROUND_ID', `Identificador de rodada inválido: ${roundId}`);
  }
  validateFilledGabarito(gabarito, dataset);

  const engineModule = resolveEngineModule(enginePath);
  const catalog = engineModule.loadCatalog(catalogPath);
  const catalogSha256 = sha256NormalizedFile(catalogPath);
  const engineSha256 = sha256NormalizedFile(enginePath);
  verifyFrozenHashes(dataset, catalog, catalogSha256, engineSha256);

  const cases = dataset.cases.map((item) => {
    try {
      const output = engineModule.evaluateRisk(item.input, { catalog });
      return {
        id: item.id,
        executionStatus: 'ok',
        clinicalResult: buildClinicalResult(output),
        technicalError: null,
      };
    } catch (error) {
      return {
        id: item.id,
        executionStatus: 'technical_error',
        clinicalResult: null,
        technicalError: {
          code: error.code || 'EXECUTION_ERROR',
          message: error.message,
          field: error.details?.field || null,
        },
      };
    }
  });

  const technicalErrorCount = cases.filter((c) => c.executionStatus === 'technical_error').length;
  const frozen = {
    catalogVersion: catalog.catalogVersion,
    catalogSha256,
    engineSha256,
    datasetSha256: sha256Object(dataset),
    gabaritoSha256: sha256Object(gabarito),
    gitCommit: commitSha || resolveGitCommit(),
  };

  const deterministicPayload = {
    roundId,
    datasetId: dataset.datasetId || 'blind-validation',
    datasetVersion: dataset.datasetVersion || '1.0.0',
    scope: catalog.scope,
    frozen: {
      catalogVersion: frozen.catalogVersion,
      catalogSha256: frozen.catalogSha256,
      engineSha256: frozen.engineSha256,
      datasetSha256: frozen.datasetSha256,
      gabaritoSha256: frozen.gabaritoSha256,
    },
    cases,
  };

  return {
    roundId,
    datasetId: deterministicPayload.datasetId,
    datasetVersion: deterministicPayload.datasetVersion,
    scope: catalog.scope,
    frozen,
    executedAt,
    deterministicDigest: sha256Object(deterministicPayload),
    summary: {
      totalCases: cases.length,
      okCount: cases.length - technicalErrorCount,
      technicalErrorCount,
    },
    cases,
  };
}

/**
 * Grava a rodada em modo append-only, bloqueando sobrescrita ou falhas técnicas.
 */
function writeBlindValidationRound({ outDir, execution }) {
  if (!outDir || typeof outDir !== 'string') {
    throw new BlindValidationError('INVALID_OUTPUT_DIR', 'Diretório de saída inválido.');
  }
  if (execution.summary?.technicalErrorCount > 0) {
    throw new BlindValidationError(
      'TECHNICAL_ERRORS_PRESENT',
      `Execução possui ${execution.summary.technicalErrorCount} falha(s) técnica(s) e não pode ser gravada como rodada oficial.`,
      { technicalErrorCount: execution.summary.technicalErrorCount }
    );
  }
  const roundDir = path.join(outDir, execution.roundId);
  const outPath = path.join(roundDir, 'execution.json');
  if (fs.existsSync(outPath)) {
    throw new BlindValidationError(
      'ROUND_ALREADY_EXISTS',
      `A rodada ${execution.roundId} já foi gravada e não pode ser sobrescrita.`
    );
  }
  fs.mkdirSync(roundDir, { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(execution, null, 2)}\n`, 'utf8');
  return outPath;
}

/**
 * Reexecuta a rodada em memória e comprova reprodutibilidade determinística.
 */
function verifyBlindValidationRound({
  roundDir,
  dataset,
  gabarito,
  catalogPath = DEFAULT_CATALOG_PATH,
  enginePath = DEFAULT_ENGINE_PATH,
  commitSha,
}) {
  const executionPath = path.join(roundDir, 'execution.json');
  if (!fs.existsSync(executionPath)) {
    throw new BlindValidationError('ROUND_NOT_FOUND', `Execução não encontrada em ${executionPath}.`);
  }
  const saved = JSON.parse(fs.readFileSync(executionPath, 'utf8'));
  const rerun = executeBlindValidationRound({
    roundId: saved.roundId,
    dataset,
    gabarito,
    catalogPath,
    enginePath,
    commitSha: commitSha || saved.frozen?.gitCommit,
  });

  if (rerun.deterministicDigest !== saved.deterministicDigest) {
    throw new BlindValidationError(
      'REPRODUCIBILITY_MISMATCH',
      `Reexecução da rodada ${saved.roundId} divergiu do artefato salvo.`,
      { expected: saved.deterministicDigest, actual: rerun.deterministicDigest }
    );
  }

  return {
    verified: true,
    roundId: saved.roundId,
    deterministicDigest: rerun.deterministicDigest,
  };
}

module.exports = {
  BlindValidationError,
  DEFAULT_ENGINE_PATH,
  ROUND_ID_PATTERN,
  executeBlindValidationRound,
  validateFilledGabarito,
  verifyBlindValidationRound,
  writeBlindValidationRound,
};
