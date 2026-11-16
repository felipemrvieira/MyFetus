const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const { BlindValidationError } = require('../services/blindValidationExecutionService');
const {
  compareValidationRounds,
  recordPoDecision,
  renderPoDecisionMarkdown,
  renderRoundsComparisonMarkdown,
  writeBlindValidationDecision,
} = require('../services/blindValidationDecisionService');

function buildComparison({
  roundId = 'r01',
  concordanceRate = 0.9444,
  meetsTarget = true,
  valid = true,
  criticalFn = 0,
  cases = null,
  catalogSha256 = 'a'.repeat(64),
  engineSha256 = 'b'.repeat(64),
  datasetVersion = '1.0.0',
} = {}) {
  const defaultCases = cases || [
    { id: 'BV-01', caseType: 'normal', outcome: 'concordante', concordant: true },
    { id: 'BV-10', caseType: 'limite', outcome: 'falso_negativo_nao_critico', concordant: false },
    { id: 'BV-20', caseType: 'conflitante', outcome: 'inconclusivo', concordant: null },
  ];
  return {
    roundId,
    datasetId: 'blind-validation',
    datasetVersion,
    frozen: { catalogVersion: '1.1.0', catalogSha256, engineSha256, gitCommit: 'abc1234' },
    global: {
      totalCases: 20,
      conclusiveCases: 18,
      inconclusiveCases: 2,
      concordantCases: Math.round(18 * concordanceRate),
      divergentCases: 18 - Math.round(18 * concordanceRate),
      concordanceRate,
      targetRate: 0.9,
      meetsTarget,
    },
    divergenceSummary: {
      falso_negativo_critico: criticalFn,
      falso_negativo_nao_critico: criticalFn === 0 ? 1 : 0,
      falso_positivo: 0,
      divergencia_pendencia_dados: 0,
    },
    roundStatus: {
      valid,
      invalidReason: valid ? null : 'Rodada inválida',
      blocked: !valid || criticalFn > 0,
      approvedForTarget: valid && meetsTarget && criticalFn === 0,
    },
    cases: defaultCases,
  };
}

test('recordPoDecision exige decisão e responsável para cada divergência e inconclusivo', () => {
  const comparison = buildComparison();

  assert.throws(
    () => recordPoDecision({
      comparison,
      roundStatus: 'corrigir',
      approver: 'Dr. Rui Pontes',
      decidedAt: '2026-11-19T10:00:00Z',
      divergenceDecisions: [
        { caseId: 'BV-10', acao: 'ajustar_limiar', justificativa: 'Ajustar limiar', responsavel: 'Dr. Rui Pontes' },
      ],
    }),
    (err) => err instanceof BlindValidationError && err.code === 'MISSING_CASE_DECISION'
  );

  const decision = recordPoDecision({
    comparison,
    roundStatus: 'corrigir',
    approver: 'Dr. Rui Pontes',
    decidedAt: '2026-11-19T10:00:00Z',
    divergenceDecisions: [
      { caseId: 'BV-10', acao: 'ajustar_limiar', justificativa: 'Ajustar limiar', responsavel: 'Dr. Rui Pontes' },
      { caseId: 'BV-20', acao: 'revisar_caso', justificativa: 'Clarificar enunciado', responsavel: 'Dr. Rui Pontes' },
    ],
  });

  assert.equal(decision.roundId, 'r01');
  assert.equal(decision.roundStatus, 'corrigir');
  assert.equal(decision.requiresRerun, true);
  assert.equal(decision.canCloseParentIssue, false);
  assert.equal(decision.divergenceDecisions.length, 2);
});

test('recordPoDecision bloqueia aprovado com falso negativo crítico, rodada inválida ou < 90% sem justificativa', () => {
  const withCriticalFn = buildComparison({ criticalFn: 1, meetsTarget: false, concordanceRate: 0.8889 });
  assert.throws(
    () => recordPoDecision({
      comparison: withCriticalFn,
      roundStatus: 'aprovado',
      approver: 'Dr. Rui Pontes',
      divergenceDecisions: [
        { caseId: 'BV-10', acao: 'manter_motor', justificativa: 'Analisado', responsavel: 'Dr. Rui Pontes' },
        { caseId: 'BV-20', acao: 'manter_motor', justificativa: 'Inconclusivo aceito', responsavel: 'Dr. Rui Pontes' },
      ],
    }),
    (err) => err instanceof BlindValidationError && err.code === 'APPROVAL_BLOCKED'
  );

  const belowTarget = buildComparison({ concordanceRate: 0.8333, meetsTarget: false });
  assert.throws(
    () => recordPoDecision({
      comparison: belowTarget,
      roundStatus: 'aprovado',
      approver: 'Dr. Rui Pontes',
      divergenceDecisions: [
        { caseId: 'BV-10', acao: 'manter_motor', justificativa: 'Aceito', responsavel: 'Dr. Rui Pontes' },
        { caseId: 'BV-20', acao: 'manter_motor', justificativa: 'Aceito', responsavel: 'Dr. Rui Pontes' },
      ],
    }),
    (err) => err instanceof BlindValidationError && err.code === 'APPROVAL_BLOCKED'
  );

  const approvedWithException = recordPoDecision({
    comparison: belowTarget,
    roundStatus: 'aprovado',
    approver: 'Dr. Rui Pontes',
    exceptionJustification: 'Divergência clínica documentada pelo P.O.',
    divergenceDecisions: [
      { caseId: 'BV-10', acao: 'manter_motor', justificativa: 'Conduta mantida', responsavel: 'Dr. Rui Pontes' },
      { caseId: 'BV-20', acao: 'manter_motor', justificativa: 'Inconclusivo aceito', responsavel: 'Dr. Rui Pontes' },
    ],
  });
  assert.equal(approvedWithException.canCloseParentIssue, true);
  assert.equal(approvedWithException.requiresRerun, false);
});

test('compareValidationRounds compara rodadas por caseId mesmo com mudança de versão e CLI grava decision.json e comparativo', () => {
  const r01 = buildComparison({
    roundId: 'r01',
    concordanceRate: 0.8889,
    meetsTarget: false,
    cases: [
      { id: 'BV-01', caseType: 'normal', outcome: 'concordante', concordant: true },
      { id: 'BV-02', caseType: 'normal', outcome: 'concordante', concordant: true },
      { id: 'BV-10', caseType: 'limite', outcome: 'falso_negativo_nao_critico', concordant: false },
      { id: 'BV-11', caseType: 'limite', outcome: 'falso_positivo', concordant: false },
      { id: 'BV-19', caseType: 'conflitante', outcome: 'concordante', concordant: true },
    ],
  });

  const r02 = buildComparison({
    roundId: 'r02',
    concordanceRate: 0.9444,
    meetsTarget: true,
    catalogSha256: 'f'.repeat(64),
    datasetVersion: '2.0.0',
    cases: [
      { id: 'BV-01', caseType: 'normal', outcome: 'concordante', concordant: true },
      { id: 'BV-02', caseType: 'normal', outcome: 'falso_positivo', concordant: false }, // regressao
      { id: 'BV-10', caseType: 'limite', outcome: 'concordante', concordant: true }, // resolvido
      { id: 'BV-11', caseType: 'limite', outcome: 'falso_positivo', concordant: false }, // persistente
      { id: 'BV-21', caseType: 'alto_risco', outcome: 'concordante', concordant: true }, // adicionado
    ],
  });

  const diff = compareValidationRounds({ previousComparison: r01, currentComparison: r02 });
  assert.equal(diff.catalogChanged, true);
  assert.equal(diff.datasetVersionChanged, true);
  assert.equal(diff.concordanceDelta, 0.0555);
  assert.deepEqual(diff.summary.resolvido, ['BV-10']);
  assert.deepEqual(diff.summary.persistente, ['BV-11']);
  assert.deepEqual(diff.summary.regressao, ['BV-02']);
  assert.deepEqual(diff.summary.mantido_concordante, ['BV-01']);
  assert.deepEqual(diff.casosAdicionados, ['BV-21']);
  assert.deepEqual(diff.casosRemovidos, ['BV-19']);

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bv-decide-'));
  const scriptPath = path.join(__dirname, '..', 'scripts', 'blindValidationDecide.js');
  const runsDir = path.join(tempRoot, 'runs');
  const reportsRoot = path.join(tempRoot, 'docs-reports');
  const reportsDir = path.join(reportsRoot, 'runs');
  const decisionInputPath = path.join(tempRoot, 'decision-input.json');

  try {
    fs.mkdirSync(path.join(runsDir, 'r01'), { recursive: true });
    fs.mkdirSync(path.join(runsDir, 'r02'), { recursive: true });
    fs.writeFileSync(path.join(runsDir, 'r01', 'comparison.json'), JSON.stringify(r01), 'utf8');
    fs.writeFileSync(path.join(runsDir, 'r02', 'comparison.json'), JSON.stringify(r02), 'utf8');
    fs.writeFileSync(decisionInputPath, JSON.stringify({
      roundStatus: 'aprovado',
      approver: 'Dr. Rui Pontes',
      decidedAt: '2026-11-20T10:00:00Z',
      divergenceDecisions: [
        { caseId: 'BV-02', acao: 'manter_motor', justificativa: 'Falso positivo aceito', responsavel: 'Dr. Rui Pontes' },
        { caseId: 'BV-11', acao: 'manter_motor', justificativa: 'Conduta conservadora mantida', responsavel: 'Dr. Rui Pontes' },
      ],
    }), 'utf8');

    const stdout = execFileSync(
      process.execPath,
      [
        scriptPath,
        '--round=r02',
        `--decision=${decisionInputPath}`,
        '--previous-round=r01',
        `--runs-dir=${runsDir}`,
        `--reports-dir=${reportsDir}`,
        `--reports-root=${reportsRoot}`,
      ],
      { encoding: 'utf8' }
    );
    const cliOut = JSON.parse(stdout);
    assert.equal(cliOut.roundId, 'r02');
    assert.equal(cliOut.canCloseParentIssue, true);
    assert.ok(fs.existsSync(path.join(runsDir, 'r02', 'decision.json')));
    assert.ok(fs.existsSync(path.join(reportsDir, 'r02', 'decisao-po.md')));
    assert.ok(fs.existsSync(path.join(reportsDir, 'r02', 'comparativo-rodadas.md')));

    assert.throws(
      () => writeBlindValidationDecision({
        roundDir: path.join(runsDir, 'r02'),
        reportDir: path.join(reportsDir, 'r02'),
        decision: { roundId: 'r02' },
        decisionMarkdown: '# dup',
      }),
      (err) => err instanceof BlindValidationError && err.code === 'ROUND_ALREADY_EXISTS'
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
