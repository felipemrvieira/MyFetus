const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const { BlindValidationError } = require('../services/blindValidationExecutionService');
const {
  compareBlindValidationRound,
  renderComparisonReportMarkdown,
} = require('../services/blindValidationComparisonService');

function build20CaseFixtures(overrides = {}) {
  const types = [
    'normal', 'normal', 'normal',
    'limite', 'limite', 'limite', 'limite', 'limite', 'limite',
    'combinacao', 'combinacao', 'combinacao',
    'ausencia', 'ausencia', 'ausencia',
    'alto_risco', 'alto_risco', 'alto_risco',
    'conflitante', 'conflitante',
  ];

  const gabaritoCases = [];
  const executionCases = [];
  const coverageCases = [];

  for (let i = 0; i < 20; i += 1) {
    const id = `BV-${String(i + 1).padStart(2, '0')}`;
    const type = types[i];
    const override = overrides[id] || {};

    const expectedSeverity = override.expectedSeverity ?? (type === 'alto_risco' ? 'vermelho' : type === 'combinacao' ? 'amarelo' : 'verde');
    const expectedMissing = override.expectedMissing ?? (type === 'ausencia');
    const motorSeverity = override.motorSeverity ?? (expectedSeverity === 'inconclusivo' ? 'verde' : expectedSeverity);
    const motorMissing = override.motorMissing ?? expectedMissing;
    const rules = override.rules ?? (motorSeverity === 'verde' ? [] : [{ category: 'blood_pressure', ruleId: 'blood_pressure_elevated', severity: motorSeverity === 'vermelho' ? 'red' : 'yellow', evidence: 'Evidência sintética', suggestedAction: 'Avaliar' }]);
    const pendingCategories = motorMissing ? [{ category: 'glucose', label: 'Glicemia', missingFields: ['glucoseValue'] }] : [];

    gabaritoCases.push({
      id,
      classificacao: expectedSeverity,
      faltamDados: expectedMissing,
      justificativa: (expectedSeverity === 'vermelho' || expectedSeverity === 'inconclusivo' || expectedMissing)
        ? `Justificativa clínica para ${id}`
        : null,
    });

    executionCases.push({
      id,
      executionStatus: override.executionStatus || 'ok',
      clinicalResult: override.executionStatus === 'technical_error' ? null : {
        overallSeverity: motorSeverity === 'vermelho' ? 'red' : motorSeverity === 'amarelo' ? 'yellow' : 'green',
        severidade: motorSeverity,
        triagem: motorSeverity === 'vermelho' ? 'urgente' : motorSeverity === 'amarelo' ? 'atencao' : 'sem_alerta',
        faltamDados: motorMissing,
        pendingCategories,
        regrasAcionadas: rules,
        justificativa: `Saída do motor para ${id}`,
      },
      technicalError: override.executionStatus === 'technical_error'
        ? { code: 'INVALID_VALUE', message: 'Erro técnico simulado', field: 'systolic' }
        : null,
    });

    coverageCases.push({
      id,
      type,
      targets: type === 'normal' ? [] : [{ ruleId: 'blood_pressure_elevated', field: 'systolic', relation: 'no_limite' }],
    });
  }

  return {
    execution: {
      roundId: 'r01',
      datasetId: 'blind-validation',
      datasetVersion: '1.0.0',
      scope: 'triagem',
      frozen: {
        catalogVersion: '1.1.0',
        catalogSha256: 'a'.repeat(64),
        engineSha256: 'b'.repeat(64),
        datasetSha256: 'c'.repeat(64),
        gabaritoSha256: 'd'.repeat(64),
        gitCommit: 'abc1234',
      },
      executedAt: '2026-11-18T10:00:00Z',
      deterministicDigest: 'e'.repeat(64),
      summary: {
        totalCases: 20,
        okCount: executionCases.filter((c) => c.executionStatus === 'ok').length,
        technicalErrorCount: executionCases.filter((c) => c.executionStatus === 'technical_error').length,
      },
      cases: executionCases,
    },
    gabarito: {
      datasetId: 'blind-validation',
      datasetVersion: '1.0.0',
      protocolVersion: '1.0.0',
      status: 'preenchido',
      evaluator: 'Dr. Rui Pontes',
      filledAt: '2026-11-17T10:00:00Z',
      cases: gabaritoCases,
    },
    coverage: {
      datasetVersion: '1.0.0',
      cases: coverageCases,
    },
  };
}

test('compareBlindValidationRound calcula meta >= 90%, por tipo de caso e por gravidade esperada', () => {
  const { execution, gabarito, coverage } = build20CaseFixtures({
    'BV-19': { expectedSeverity: 'inconclusivo', motorSeverity: 'verde' },
    'BV-20': { expectedSeverity: 'inconclusivo', motorSeverity: 'amarelo' },
  });

  const comparison = compareBlindValidationRound({ execution, gabarito, coverage });
  assert.equal(comparison.global.totalCases, 20);
  assert.equal(comparison.global.conclusiveCases, 18);
  assert.equal(comparison.global.inconclusiveCases, 2);
  assert.equal(comparison.global.concordantCases, 18);
  assert.equal(comparison.global.concordanceRate, 1);
  assert.equal(comparison.global.meetsTarget, true);
  assert.equal(comparison.roundStatus.valid, true);
  assert.equal(comparison.roundStatus.blocked, false);
  assert.equal(comparison.roundStatus.approvedForTarget, true);
  assert.equal(comparison.byCaseType.conflitante.inconclusive, 2);
  assert.equal(comparison.byExpectedSeverity.vermelho.concordant, 3);
});

test('compareBlindValidationRound aplica precedência de falso negativo crítico e isola divergencia_pendencia_dados', () => {
  const { execution, gabarito, coverage } = build20CaseFixtures({
    'BV-16': { expectedSeverity: 'vermelho', expectedMissing: true, motorSeverity: 'amarelo', motorMissing: false }, // falso_negativo_critico vence faltamDados
    'BV-10': { expectedSeverity: 'amarelo', motorSeverity: 'verde' }, // falso_negativo_nao_critico
    'BV-01': { expectedSeverity: 'verde', motorSeverity: 'amarelo' }, // falso_positivo
    'BV-13': { expectedSeverity: 'verde', expectedMissing: true, motorSeverity: 'verde', motorMissing: false }, // divergencia_pendencia_dados
  });

  const comparison = compareBlindValidationRound({ execution, gabarito, coverage });
  assert.equal(comparison.divergenceSummary.falso_negativo_critico, 1);
  assert.equal(comparison.divergenceSummary.falso_negativo_nao_critico, 1);
  assert.equal(comparison.divergenceSummary.falso_positivo, 1);
  assert.equal(comparison.divergenceSummary.divergencia_pendencia_dados, 1);
  assert.equal(comparison.global.concordantCases, 16);
  assert.equal(comparison.global.concordanceRate, 0.8);
  assert.equal(comparison.global.meetsTarget, false);
  assert.equal(comparison.roundStatus.blocked, true);

  const bv16 = comparison.cases.find((c) => c.id === 'BV-16');
  assert.equal(bv16.outcome, 'falso_negativo_critico');
  const bv10 = comparison.cases.find((c) => c.id === 'BV-10');
  assert.ok(bv10.clinicalCategories.includes('blood_pressure'));
  assert.ok(comparison.byRule.blood_pressure_elevated.divergent >= 1);
  const bv01 = comparison.cases.find((c) => c.id === 'BV-01');
  assert.equal(bv01.outcome, 'falso_positivo');
  assert.equal(bv01.severityDelta, 'verde->amarelo');
  const bv13 = comparison.cases.find((c) => c.id === 'BV-13');
  assert.equal(bv13.outcome, 'divergencia_pendencia_dados');
});

test('compareBlindValidationRound invalida rodada com > 2 inconclusivos e bloqueia erro técnico ou gabarito aberto', () => {
  const tooManyInconclusive = build20CaseFixtures({
    'BV-18': { expectedSeverity: 'inconclusivo' },
    'BV-19': { expectedSeverity: 'inconclusivo' },
    'BV-20': { expectedSeverity: 'inconclusivo' },
  });
  const res = compareBlindValidationRound(tooManyInconclusive);
  assert.equal(res.roundStatus.valid, false);
  assert.equal(res.roundStatus.blocked, true);
  assert.match(res.roundStatus.invalidReason, /inconclusiv/i);

  const withTechErr = build20CaseFixtures({ 'BV-01': { executionStatus: 'technical_error' } });
  assert.throws(
    () => compareBlindValidationRound(withTechErr),
    (err) => err instanceof BlindValidationError && err.code === 'TECHNICAL_ERRORS_PRESENT'
  );

  const openGabarito = build20CaseFixtures();
  openGabarito.gabarito.status = 'nao_preenchido';
  assert.throws(
    () => compareBlindValidationRound(openGabarito),
    (err) => err instanceof BlindValidationError && err.code === 'GABARITO_NOT_CLOSED'
  );
});

test('renderComparisonReportMarkdown e CLI blindValidationCompare geram comparison.json e relatorio-concordancia.md', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bv-compare-'));
  const scriptPath = path.join(__dirname, '..', 'scripts', 'blindValidationCompare.js');
  const runsDir = path.join(tempRoot, 'runs');
  const reportsDir = path.join(tempRoot, 'reports');
  const gabaritoPath = path.join(tempRoot, 'gabarito.json');
  const coveragePath = path.join(tempRoot, 'coverage.json');

  try {
    const { execution, gabarito, coverage } = build20CaseFixtures({
      'BV-16': { expectedSeverity: 'vermelho', motorSeverity: 'amarelo' },
      'BV-20': { expectedSeverity: 'inconclusivo' },
    });

    const comparison = compareBlindValidationRound({ execution, gabarito, coverage });
    const markdown = renderComparisonReportMarkdown(comparison);
    assert.match(markdown, /Meta de concordância.*90%/);
    assert.match(markdown, /Falso negativo crítico.*BLOQUEADOR/i);
    assert.match(markdown, /BV-16/);
    assert.match(markdown, /casos 100% sintéticos/i);

    fs.mkdirSync(path.join(runsDir, 'r01'), { recursive: true });
    fs.writeFileSync(path.join(runsDir, 'r01', 'execution.json'), JSON.stringify(execution), 'utf8');
    fs.writeFileSync(gabaritoPath, JSON.stringify(gabarito), 'utf8');
    fs.writeFileSync(coveragePath, JSON.stringify(coverage), 'utf8');

    const stdout = execFileSync(
      process.execPath,
      [
        scriptPath,
        '--round=r01',
        `--gabarito=${gabaritoPath}`,
        `--coverage=${coveragePath}`,
        `--runs-dir=${runsDir}`,
        `--reports-dir=${reportsDir}`,
      ],
      { encoding: 'utf8' }
    );
    const cliResult = JSON.parse(stdout);
    assert.equal(cliResult.roundId, 'r01');
    assert.equal(cliResult.blocked, true);
    assert.ok(fs.existsSync(path.join(runsDir, 'r01', 'comparison.json')));
    assert.ok(fs.existsSync(path.join(reportsDir, 'r01', 'relatorio-concordancia.md')));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
