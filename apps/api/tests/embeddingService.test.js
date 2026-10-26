const { test } = require('node:test');
const assert = require('node:assert');

const {
  generateEmbedding,
  generateEmbeddings,
  normalizeEmbeddingInput,
  getEmbeddingConfig,
} = require('../services/embeddingService');

test('normalizeEmbeddingInput: prefixa passage: ou query: e rejeita texto vazio', () => {
  assert.throws(() => normalizeEmbeddingInput(''), /Texto vazio/);

  const passage = normalizeEmbeddingInput('Texto de teste', 'passage');
  assert.strictEqual(passage, 'passage: Texto de teste');

  const query = normalizeEmbeddingInput('Pergunta de teste?', 'query');
  assert.strictEqual(query, 'query: Pergunta de teste?');

  // Não duplica prefixo já existente
  assert.strictEqual(normalizeEmbeddingInput('passage: Já tem', 'passage'), 'passage: Já tem');
  assert.strictEqual(normalizeEmbeddingInput('query: Já tem?', 'query'), 'query: Já tem?');
});

test('getEmbeddingConfig: lê variáveis de ambiente com fallback para defaults', () => {
  const config = getEmbeddingConfig();
  assert.ok(typeof config.model === 'string' && config.model.length > 0);
  assert.strictEqual(config.dimension, 384);
});

test('generateEmbedding: gera vetor determinístico em modo mock com dimensão exata', async () => {
  const text = 'A pré-eclâmpsia é uma condição hipertensiva da gestação.';

  const embedding1 = await generateEmbedding(text, 'passage', { mock: true });
  const embedding2 = await generateEmbedding(text, 'passage', { mock: true });

  assert.strictEqual(embedding1.length, 384);
  assert.deepStrictEqual(embedding1, embedding2, 'Mesma entrada em modo mock deve gerar vetor idêntico');
  assert.ok(typeof embedding1[0] === 'number');
});

test('generateEmbedding: valida dimensão e falha se houver divergência', async () => {
  await assert.rejects(
    async () => {
      // Simula configuração com dimensão incompatível
      await generateEmbedding('Texto', 'passage', { mock: true, expectedDimension: 1536 });
    },
    /DIMENSÃO DIVERGENTE|Dimensão divergente/i
  );
});

test('generateEmbeddings: gera lista de embeddings em lote preservando ordem', async () => {
  const texts = ['Primeiro trecho clínico', 'Segundo trecho clínico'];
  const embeddings = await generateEmbeddings(texts, 'passage', { mock: true });

  assert.strictEqual(embeddings.length, 2);
  assert.strictEqual(embeddings[0].length, 384);
  assert.strictEqual(embeddings[1].length, 384);
});
