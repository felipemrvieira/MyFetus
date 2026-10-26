const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const {
  ingestGuidelines,
  loadCheckpoint,
  saveCheckpoint,
  isDocumentIndexed,
} = require('../services/ragIngestionService');
const { resetMockStore, describeIndexStats } = require('../services/vectorStoreService');

const TEST_CHECKPOINT_PATH = path.join(__dirname, '.test-checkpoint.json');
const FIXTURES_DIR = path.resolve(__dirname, 'fixtures', 'rag');

before(() => {
  if (fs.existsSync(TEST_CHECKPOINT_PATH)) {
    fs.unlinkSync(TEST_CHECKPOINT_PATH);
  }
});

after(() => {
  if (fs.existsSync(TEST_CHECKPOINT_PATH)) {
    fs.unlinkSync(TEST_CHECKPOINT_PATH);
  }
});

test('loadCheckpoint e saveCheckpoint: persiste e recupera estado de documentos', () => {
  const initial = loadCheckpoint(TEST_CHECKPOINT_PATH);
  assert.deepStrictEqual(initial, { documents: {} });

  const updated = {
    documents: {
      'doc-1': {
        sha256: 'abc1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcd',
        completedAt: new Date().toISOString(),
        vectorCount: 10,
      },
    },
  };

  saveCheckpoint(TEST_CHECKPOINT_PATH, updated);
  const reloaded = loadCheckpoint(TEST_CHECKPOINT_PATH);
  assert.strictEqual(reloaded.documents['doc-1'].vectorCount, 10);

  const indexed = isDocumentIndexed(
    reloaded,
    'doc-1',
    'abc1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcd'
  );
  assert.strictEqual(indexed, true);

  const changedHash = isDocumentIndexed(reloaded, 'doc-1', 'diferente');
  assert.strictEqual(changedHash, false);
});

test('ingestGuidelines: reexecução é idempotente e utiliza checkpoint para resume', async () => {
  resetMockStore();
  if (fs.existsSync(TEST_CHECKPOINT_PATH)) fs.unlinkSync(TEST_CHECKPOINT_PATH);

  const os = require('os');
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rag-test-guidelines-'));
  const syntheticPdfPath = path.join(FIXTURES_DIR, 'synthetic-guideline.pdf');
  const destPdfPath = path.join(tempDir, 'synthetic-guideline.pdf');

  fs.copyFileSync(syntheticPdfPath, destPdfPath);

  const pdfBytes = fs.readFileSync(destPdfPath);
  const crypto = require('crypto');
  const sha256 = crypto.createHash('sha256').update(pdfBytes).digest('hex');

  const mockManifest = {
    manifestVersion: '1.0.0',
    hashAlgorithm: 'sha256',
    sources: [
      {
        documentId: 'synthetic-guideline',
        category: 'obrigatoria',
        title: 'Diretriz Sintética de Teste',
        issuer: 'Ministério da Saúde',
        year: 2026,
        language: 'pt-BR',
        documentType: 'manual',
        sha256,
        state: 'aprovado',
        approval: { by: 'Revisão Clínica', date: '2026-10-26' },
      },
    ],
  };

  try {
    // Primeira execução
    const res1 = await ingestGuidelines({
      manifest: mockManifest,
      guidelinesDir: tempDir,
      checkpointPath: TEST_CHECKPOINT_PATH,
      mock: true,
    });

    assert.strictEqual(res1.documents, 1);
    assert.strictEqual(res1.skippedCount, 0);
    assert.strictEqual(res1.results[0].status, 'indexed');
    const initialVectors = res1.results[0].vectors;
    assert.ok(initialVectors > 0);

    // Segunda execução (sem force) -> deve pular via checkpoint (resume)
    const res2 = await ingestGuidelines({
      manifest: mockManifest,
      guidelinesDir: tempDir,
      checkpointPath: TEST_CHECKPOINT_PATH,
      mock: true,
    });

    assert.strictEqual(res2.skippedCount, 1);
    assert.strictEqual(res2.results[0].status, 'skipped');

    // Terceira execução com force: true -> reprocessa mantendo mesma contagem estável
    const res3 = await ingestGuidelines({
      manifest: mockManifest,
      guidelinesDir: tempDir,
      checkpointPath: TEST_CHECKPOINT_PATH,
      mock: true,
      force: true,
    });

    assert.strictEqual(res3.skippedCount, 0);
    assert.strictEqual(res3.results[0].status, 'indexed');
    assert.strictEqual(res3.results[0].vectors, initialVectors);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
