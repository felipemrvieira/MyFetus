const { test } = require('node:test');
const assert = require('node:assert');

const {
  deleteVectorsByDocument,
  upsertVectors,
  queryVectors,
  describeIndexStats,
  validateVector,
  validatePineconeRecord,
  sanitizeErrorMessage,
  resetMockStore,
  getVectorStoreConfig,
} = require('../services/vectorStoreService');

function createFakeVector(size = 384, value = 0.1) {
  return Array.from({ length: size }, () => value);
}

test('getVectorStoreConfig: retorna configurações com defaults adequados', () => {
  const config = getVectorStoreConfig();
  assert.strictEqual(config.dimension, 384);
  assert.strictEqual(config.namespace, 'guidelines');
  assert.ok(config.batchSize >= 1);
});

test('sanitizeErrorMessage: remove chaves, tokens e URLs sensíveis de mensagens de erro', () => {
  const raw = 'Failed to call https://api.pinecone.io with key pc_key_secret_12345 and token Bearer xyz987';
  const sanitized = sanitizeErrorMessage(raw);

  assert.ok(!sanitized.includes('pc_key_secret_12345'));
  assert.ok(!sanitized.includes('xyz987'));
  assert.ok(sanitized.includes('[REDACTED]'));
});

test('validatePineconeRecord: valida estrutura e dimensão', () => {
  assert.throws(() => validatePineconeRecord(null), /Registro inválido/);
  assert.throws(() => validatePineconeRecord({}), /sem id/);
  assert.throws(() => validatePineconeRecord({ id: 'doc-1', values: [1, 2] }), /Dimensão inválida/);
  assert.throws(
    () => validatePineconeRecord({ id: 'doc-1', values: createFakeVector() }),
    /sem metadata/
  );
});

test('upsertVectors: idempotência estrita em reexecuções (mesmo ID não duplica contagem)', async () => {
  resetMockStore();

  const records = [
    {
      id: 'manual-baixo-risco-ms-2012-p1-c0',
      values: createFakeVector(384, 0.2),
      metadata: { documentId: 'manual-baixo-risco-ms-2012', page: 1 },
    },
    {
      id: 'manual-baixo-risco-ms-2012-p1-c1',
      values: createFakeVector(384, 0.3),
      metadata: { documentId: 'manual-baixo-risco-ms-2012', page: 1 },
    },
  ];

  // Primeira execução
  const res1 = await upsertVectors(records, 'guidelines-test', { mock: true });
  assert.strictEqual(res1.upsertedCount, 2);

  const stats1 = await describeIndexStats({ mock: true });
  assert.strictEqual(stats1.namespaces['guidelines-test'].recordCount, 2);

  // Segunda execução com os mesmos registros (reexecução idempotente)
  const res2 = await upsertVectors(records, 'guidelines-test', { mock: true });
  assert.strictEqual(res2.upsertedCount, 2);

  const stats2 = await describeIndexStats({ mock: true });
  // A contagem deve permanecer exatamente 2, sem duplicatas
  assert.strictEqual(stats2.namespaces['guidelines-test'].recordCount, 2);
});

test('upsertVectors: divide registros em lotes (batching) configuráveis', async () => {
  resetMockStore();

  const records = Array.from({ length: 15 }, (_, i) => ({
    id: `batch-test-p1-c${i}`,
    values: createFakeVector(384, 0.1 * i),
    metadata: { documentId: 'batch-test', index: i },
  }));

  // Envia com batchSize = 5 -> 3 lotes
  const result = await upsertVectors(records, 'guidelines-test', {
    mock: true,
    batchSize: 5,
  });

  assert.strictEqual(result.upsertedCount, 15);
  assert.strictEqual(result.batches, 3);
});

test('upsertVectors: executa retry com backoff em erros transitórios', async () => {
  resetMockStore();

  let attempts = 0;
  const flakeyAdapter = async (batch) => {
    attempts += 1;
    if (attempts < 3) {
      const err = new Error('Connection timeout to Pinecone (transient ECONNRESET)');
      err.code = 'ECONNRESET';
      throw err;
    }
    return { count: batch.length };
  };

  const record = {
    id: 'retry-test-c0',
    values: createFakeVector(),
    metadata: { test: true },
  };

  const res = await upsertVectors([record], 'guidelines-test', {
    mock: true,
    customAdapter: flakeyAdapter,
    maxRetries: 3,
    retryDelayMs: 10,
  });

  assert.strictEqual(res.upsertedCount, 1);
  assert.strictEqual(attempts, 3, 'Deve tentar 3 vezes antes de obter sucesso');
});

test('deleteVectorsByDocument: remove somente os vetores do documento no namespace', async () => {
  resetMockStore();
  const records = [
    { id: 'doc-a-p1-c0', values: createFakeVector(), metadata: { documentId: 'doc-a' } },
    { id: 'doc-b-p1-c0', values: createFakeVector(), metadata: { documentId: 'doc-b' } },
  ];

  await upsertVectors(records, 'guidelines-test', { mock: true });
  const result = await deleteVectorsByDocument('doc-a', 'guidelines-test', { mock: true });
  const stats = await describeIndexStats({ mock: true });

  assert.strictEqual(result.deletedCount, 1);
  assert.strictEqual(stats.namespaces['guidelines-test'].recordCount, 1);
  assert.strictEqual((await queryVectors(createFakeVector(), {
    namespace: 'guidelines-test',
    mock: true,
    topK: 5,
  })).matches[0].metadata.documentId, 'doc-b');
});
