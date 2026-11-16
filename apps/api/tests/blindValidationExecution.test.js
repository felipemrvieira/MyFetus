const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  BlindValidationError,
  executeBlindValidationRound,
  validateFilledGabarito,
  verifyBlindValidationRound,
  writeBlindValidationRound,
} = require('../services/blindValidationExecutionService');

function buildDataset() {
  return {
    datasetId: 'blind-validation',
    datasetVersion: '1.0.0',
    cases: [
      {
        id: 'BV-01',
        input: {
          maternalAge: 29,
          gestationalWeeks: 30,
          systolic: 120,
          diastolic: 78,
          glucoseType: 'fasting',
          glucoseValue: 82,
          prePregnancyBmi: 22.5,
          fundalHeight: 30,
          fundalHeightPercentile: 50,
          fetalHeartRate: 140,
          familyHistory: false,
          clinicalHistory: false,
          previousPregnancyRisk: false,
          currentPregnancyFlags: [],
          vaccinationStatus: 'regular',
        },
      },
      {
        id: 'BV-02',
        input: {
          maternalAge: 32,
          gestationalWeeks: 33,
          systolic: 170,
          diastolic: 112,
          glucoseType: 'fasting',
          glucoseValue: 83,
          prePregnancyBmi: 24.0,
          fundalHeight: 32,
          fundalHeightPercentile: 45,
          fetalHeartRate: 136,
          familyHistory: false,
          clinicalHistory: false,
          previousPregnancyRisk: false,
          currentPregnancyFlags: [],
          vaccinationStatus: 'regular',
        },
      },
    ],
  };
}

function buildValidGabarito() {
  return {
    datasetId: 'blind-validation',
    datasetVersion: '1.0.0',
    protocolVersion: '1.0.0',
    status: 'preenchido',
    evaluator: 'Dr. Rui Pontes',
    filledAt: '2026-11-17T10:00:00Z',
    cases: [
      { id: 'BV-01', classificacao: 'verde', faltamDados: false, justificativa: null },
      { id: 'BV-02', classificacao: 'vermelho', faltamDados: false, justificativa: 'PA 170/112 em faixa crítica.' },
    ],
  };
}

test('validateFilledGabarito aceita gabarito fechado e bloqueia gabarito aberto ou incompleto', () => {
  const dataset = buildDataset();
  const valid = buildValidGabarito();
  assert.equal(validateFilledGabarito(valid, dataset), true);

  const notClosed = { ...valid, status: 'nao_preenchido' };
  assert.throws(
    () => validateFilledGabarito(notClosed, dataset),
    (err) => err instanceof BlindValidationError && err.code === 'GABARITO_NOT_CLOSED'
  );

  const missingJustification = {
    ...valid,
    cases: [
      valid.cases[0],
      { id: 'BV-02', classificacao: 'vermelho', faltamDados: false, justificativa: '   ' },
    ],
  };
  assert.throws(
    () => validateFilledGabarito(missingJustification, dataset),
    (err) => err instanceof BlindValidationError && err.code === 'INVALID_GABARITO'
  );

  const leakedEngine = {
    ...valid,
    cases: [
      { ...valid.cases[0], overallSeverity: 'green' },
      valid.cases[1],
    ],
  };
  assert.throws(
    () => validateFilledGabarito(leakedEngine, dataset),
    (err) => err instanceof BlindValidationError && err.code === 'BLINDING_VIOLATION'
  );
});

test('executeBlindValidationRound registra triagem, severidade, justificativa, faltamDados e metadados de versão', () => {
  const dataset = buildDataset();
  dataset.cases.push({
    id: 'BV-03',
    input: {
      ...dataset.cases[0].input,
      systolic: undefined,
      diastolic: undefined,
    },
  });
  delete dataset.cases[2].input.systolic;
  delete dataset.cases[2].input.diastolic;

  const gabarito = buildValidGabarito();
  gabarito.cases.push({
    id: 'BV-03',
    classificacao: 'verde',
    faltamDados: true,
    justificativa: 'Pressão arterial ausente.',
  });

  const execution = executeBlindValidationRound({
    roundId: 'r01',
    dataset,
    gabarito,
    commitSha: 'abc1234',
    executedAt: '2026-11-18T10:00:00Z',
  });

  assert.equal(execution.roundId, 'r01');
  assert.equal(execution.frozen.gitCommit, 'abc1234');
  assert.match(execution.frozen.catalogSha256, /^[a-f0-9]{64}$/);
  assert.match(execution.frozen.engineSha256, /^[a-f0-9]{64}$/);
  assert.match(execution.deterministicDigest, /^[a-f0-9]{64}$/);
  assert.deepEqual(execution.summary, { totalCases: 3, okCount: 3, technicalErrorCount: 0 });

  const c1 = execution.cases.find((c) => c.id === 'BV-01');
  assert.equal(c1.executionStatus, 'ok');
  assert.equal(c1.clinicalResult.severidade, 'verde');
  assert.equal(c1.clinicalResult.triagem, 'sem_alerta');
  assert.equal(c1.clinicalResult.faltamDados, false);
  assert.match(c1.clinicalResult.justificativa, /Nenhum critério de alerta/);

  const c2 = execution.cases.find((c) => c.id === 'BV-02');
  assert.equal(c2.clinicalResult.severidade, 'vermelho');
  assert.equal(c2.clinicalResult.triagem, 'urgente');
  assert.equal(c2.clinicalResult.regrasAcionadas[0].ruleId, 'blood_pressure_severe');
  assert.ok(c2.clinicalResult.justificativa.length > 0);

  const c3 = execution.cases.find((c) => c.id === 'BV-03');
  assert.equal(c3.clinicalResult.severidade, 'verde');
  assert.equal(c3.clinicalResult.faltamDados, true);
  assert.equal(c3.clinicalResult.pendingCategories[0].category, 'blood_pressure');
  assert.match(c3.clinicalResult.justificativa, /Dados obrigatórios ausentes/);
});

test('executeBlindValidationRound separa falha técnica de divergência clínica e valida hash congelado', () => {
  const dataset = buildDataset();
  dataset.cases[0].input.systolic = 500;
  const gabarito = buildValidGabarito();

  const execution = executeBlindValidationRound({
    roundId: 'r01',
    dataset,
    gabarito,
    commitSha: 'abc1234',
  });

  assert.deepEqual(execution.summary, { totalCases: 2, okCount: 1, technicalErrorCount: 1 });
  const c1 = execution.cases.find((c) => c.id === 'BV-01');
  assert.equal(c1.executionStatus, 'technical_error');
  assert.equal(c1.clinicalResult, null);
  assert.equal(c1.technicalError.code, 'INVALID_VALUE');
  assert.equal(c1.technicalError.field, 'systolic');

  const mismatchedDataset = buildDataset();
  mismatchedDataset.frozen = {
    catalogVersion: '1.1.0',
    catalogSha256: '0'.repeat(64),
    engineSha256: '0'.repeat(64),
  };
  assert.throws(
    () => executeBlindValidationRound({ roundId: 'r01', dataset: mismatchedDataset, gabarito }),
    (err) => err instanceof BlindValidationError && err.code === 'FROZEN_MISMATCH'
  );
});

test('writeBlindValidationRound é append-only e verifyBlindValidationRound comprova reprodutibilidade', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bv-run-'));
  try {
    const dataset = buildDataset();
    const gabarito = buildValidGabarito();
    const execution = executeBlindValidationRound({
      roundId: 'r01',
      dataset,
      gabarito,
      commitSha: 'abc1234',
      executedAt: '2026-11-18T10:00:00Z',
    });

    const outPath = writeBlindValidationRound({ outDir: tempRoot, execution });
    assert.ok(fs.existsSync(outPath));

    assert.throws(
      () => writeBlindValidationRound({ outDir: tempRoot, execution }),
      (err) => err instanceof BlindValidationError && err.code === 'ROUND_ALREADY_EXISTS'
    );

    const verification = verifyBlindValidationRound({
      roundDir: path.join(tempRoot, 'r01'),
      dataset,
      gabarito,
      commitSha: 'abc1234',
    });
    assert.equal(verification.verified, true);
    assert.equal(verification.roundId, 'r01');
    assert.equal(verification.deterministicDigest, execution.deterministicDigest);

    const brokenDataset = buildDataset();
    brokenDataset.cases[0].input.systolic = 175;
    assert.throws(
      () => verifyBlindValidationRound({
        roundDir: path.join(tempRoot, 'r01'),
        dataset: brokenDataset,
        gabarito,
      }),
      (err) => err instanceof BlindValidationError && err.code === 'REPRODUCIBILITY_MISMATCH'
    );

    const failedExec = executeBlindValidationRound({
      roundId: 'r02',
      dataset: (() => {
        const d = buildDataset();
        d.cases[0].input.systolic = 500;
        return d;
      })(),
      gabarito,
    });
    assert.throws(
      () => writeBlindValidationRound({ outDir: tempRoot, execution: failedExec }),
      (err) => err instanceof BlindValidationError && err.code === 'TECHNICAL_ERRORS_PRESENT'
    );
    assert.equal(fs.existsSync(path.join(tempRoot, 'r02', 'execution.json')), false);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('CLI blindValidationRun executa --round e --verify-round e bloqueia sobrescrita', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bv-cli-'));
  const scriptPath = path.join(__dirname, '..', 'scripts', 'blindValidationRun.js');
  const casesPath = path.join(tempRoot, 'cases.json');
  const gabaritoPath = path.join(tempRoot, 'gabarito.json');
  const outDir = path.join(tempRoot, 'runs');

  try {
    fs.writeFileSync(casesPath, JSON.stringify(buildDataset()), 'utf8');
    fs.writeFileSync(gabaritoPath, JSON.stringify(buildValidGabarito()), 'utf8');

    const runOut = execFileSync(
      process.execPath,
      [scriptPath, '--round=r01', `--cases=${casesPath}`, `--gabarito=${gabaritoPath}`, `--out-dir=${outDir}`],
      { encoding: 'utf8' }
    );
    const parsedRun = JSON.parse(runOut);
    assert.equal(parsedRun.status, 'recorded');
    assert.equal(parsedRun.roundId, 'r01');
    assert.ok(fs.existsSync(path.join(outDir, 'r01', 'execution.json')));

    const verifyOut = execFileSync(
      process.execPath,
      [scriptPath, '--verify-round=r01', `--cases=${casesPath}`, `--gabarito=${gabaritoPath}`, `--out-dir=${outDir}`],
      { encoding: 'utf8' }
    );
    const parsedVerify = JSON.parse(verifyOut);
    assert.equal(parsedVerify.verified, true);

    assert.throws(() => {
      execFileSync(
        process.execPath,
        [scriptPath, '--round=r01', `--cases=${casesPath}`, `--gabarito=${gabaritoPath}`, `--out-dir=${outDir}`],
        { encoding: 'utf8', stdio: 'pipe' }
      );
    });
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
