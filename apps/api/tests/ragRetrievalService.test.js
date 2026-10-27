const test = require('node:test');
const assert = require('node:assert/strict');

const embeddingService = require('../services/embeddingService');
const vectorStoreService = require('../services/vectorStoreService');
const {
  RagRetrievalError,
  normalizeFilters,
  retrieve,
} = require('../services/ragRetrievalService');

test('normalizeFilters rejeita campos legados que não existem nos metadados do RAG', () => {
  assert.throws(
    () => normalizeFilters({ tema: 'pré-eclâmpsia' }),
    (error) => error instanceof RagRetrievalError && error.code === 'INVALID_FILTER'
  );
});

test('retrieve usa namespace explícito, prefixo query e preserva metadados de fonte', async () => {
  const originalEmbedding = embeddingService.generateEmbedding;
  const originalQuery = vectorStoreService.queryVectors;
  let receivedInput;
  let receivedOptions;

  embeddingService.generateEmbedding = async (text, inputType) => {
    receivedInput = { text, inputType };
    return [0.1, 0.2];
  };
  vectorStoreService.queryVectors = async (vector, options) => {
    receivedOptions = { vector, ...options };
    return {
      matches: [{
        score: 0.98765,
        metadata: {
          text: 'Trecho aprovado',
          source: 'Manual sintético',
          page: 4,
          section: 'vacinas',
          documentId: 'manual-sintetico',
          language: 'pt-BR',
          documentType: 'manual',
        },
      }],
    };
  };

  try {
    const result = await retrieve({
      query: 'vacinas na gestação',
      topK: 3,
      namespace: 'guidelines-test',
      filters: { section: { $in: ['vacinas'] } },
    });

    assert.deepEqual(receivedInput, { text: 'vacinas na gestação', inputType: 'query' });
    assert.equal(receivedOptions.namespace, 'guidelines-test');
    assert.equal(receivedOptions.topK, 3);
    assert.deepEqual(receivedOptions.filter, { section: { $in: ['vacinas'] } });
    assert.equal(result.status, 'ok');
    assert.equal(result.resultados[0].pagina, 4);
    assert.equal(result.resultados[0].secao, 'vacinas');
    assert.equal(result.resultados[0].relevancia, 0.9877);
  } finally {
    embeddingService.generateEmbedding = originalEmbedding;
    vectorStoreService.queryVectors = originalQuery;
  }
});

test('retrieve retorna estado determinístico quando não há resultados', async () => {
  const originalEmbedding = embeddingService.generateEmbedding;
  const originalQuery = vectorStoreService.queryVectors;
  embeddingService.generateEmbedding = async () => [0.1];
  vectorStoreService.queryVectors = async () => ({ matches: [] });

  try {
    const result = await retrieve({ query: 'sem correspondência', namespace: 'guidelines-test' });
    assert.equal(result.status, 'empty');
    assert.deepEqual(result.resultados, []);
  } finally {
    embeddingService.generateEmbedding = originalEmbedding;
    vectorStoreService.queryVectors = originalQuery;
  }
});

test('retrieve transforma indisponibilidade do vector store em erro tipado e seguro', async () => {
  const originalEmbedding = embeddingService.generateEmbedding;
  const originalQuery = vectorStoreService.queryVectors;
  embeddingService.generateEmbedding = async () => [0.1];
  vectorStoreService.queryVectors = async () => {
    throw new Error('PINECONE_API_KEY=secret timeout');
  };

  try {
    await assert.rejects(
      () => retrieve({ query: 'consulta', namespace: 'guidelines-test' }),
      (error) => error instanceof RagRetrievalError &&
        error.code === 'VECTOR_STORE_UNAVAILABLE' &&
        error.message === 'A base de conhecimento está indisponível.'
    );
  } finally {
    embeddingService.generateEmbedding = originalEmbedding;
    vectorStoreService.queryVectors = originalQuery;
  }
});
