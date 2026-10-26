/**
 * vectorStoreService.js
 *
 * Comunicação com o Pinecone para armazenamento e consulta vetorial.
 * Suporta batching, retry exponencial com backoff, sanitização de erros
 * e modo mock em memória para testes herméticos e CI sem credenciais reais.
 */

require('dotenv').config();

const { Pinecone } = require('@pinecone-database/pinecone');

function getVectorStoreConfig() {
  return {
    apiKey: process.env.PINECONE_API_KEY,
    indexName: process.env.PINECONE_INDEX_NAME || 'myfetus-rag',
    namespace: process.env.PINECONE_NAMESPACE || 'guidelines',
    dimension: Number(process.env.RAG_EMBEDDING_DIMENSION || process.env.EMBEDDING_DIMENSION || 384),
    batchSize: Number(process.env.RAG_UPSERT_BATCH_SIZE || 100),
  };
}

let pineconeClient = null;
let pineconeIndex = null;

// Mock Store em memória para testes unitários/CI
const mockStore = new Map();

function resetMockStore() {
  mockStore.clear();
}

function sanitizeErrorMessage(message) {
  if (!message) return '';
  return String(message)
    .replace(/(api[_-]?key\s*[:=]\s*)[^\s,;&]+/gi, '$1[REDACTED]')
    .replace(/(Bearer\s+)[^\s,;&]+/gi, '$1[REDACTED]')
    .replace(/pc_key_[a-zA-Z0-9_\-]+/gi, '[REDACTED]')
    .replace(/https?:\/\/[^\s]+/gi, (url) => url.replace(/key=[^&]+/g, 'key=[REDACTED]'));
}

function validatePineconeConfig() {
  const config = getVectorStoreConfig();
  if (!config.apiKey) {
    throw new Error('PINECONE_API_KEY não configurada no .env.');
  }
  if (!config.indexName) {
    throw new Error('PINECONE_INDEX_NAME não configurado no .env.');
  }
}

function getPineconeClient() {
  validatePineconeConfig();
  if (!pineconeClient) {
    const config = getVectorStoreConfig();
    pineconeClient = new Pinecone({
      apiKey: config.apiKey,
    });
  }
  return pineconeClient;
}

function getPineconeIndex() {
  if (!pineconeIndex) {
    const config = getVectorStoreConfig();
    const client = getPineconeClient();
    pineconeIndex = client.index(config.indexName);
  }
  return pineconeIndex;
}

function getNamespace(namespace) {
  const config = getVectorStoreConfig();
  const ns = namespace || config.namespace;
  const index = getPineconeIndex();
  return index.namespace(ns);
}

function validateVector(vector) {
  const config = getVectorStoreConfig();
  if (!Array.isArray(vector)) {
    throw new Error('Vetor inválido: values precisa ser um array.');
  }

  if (vector.length !== config.dimension) {
    throw new Error(
      `Dimensão inválida: ${vector.length}. Esperado: ${config.dimension}.`
    );
  }
}

function validatePineconeRecord(record) {
  if (!record || typeof record !== 'object') {
    throw new Error('Registro inválido.');
  }

  if (!record.id) {
    throw new Error('Registro sem id.');
  }

  validateVector(record.values);

  if (!record.metadata || typeof record.metadata !== 'object') {
    throw new Error('Registro sem metadata.');
  }
}

/**
 * Executa uma operação assíncrona com retry e exponential backoff com jitter.
 */
async function withRetry(operation, options = {}) {
  const maxRetries = Number(options.maxRetries || 3);
  const baseDelayMs = Number(options.retryDelayMs || 150);

  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    try {
      return await operation();
    } catch (err) {
      if (attempt >= maxRetries) {
        throw new Error(sanitizeErrorMessage(err.message));
      }
      const jitter = Math.random() * 40;
      const delay = baseDelayMs * Math.pow(2, attempt - 1) + jitter;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

function isMockMode(options = {}) {
  const config = getVectorStoreConfig();
  return (
    options.mock === true ||
    process.env.PINECONE_MOCK === 'true' ||
    !config.apiKey
  );
}

/**
 * Envia vetores para o Pinecone em lotes com retry e idempotência estrita.
 */
async function upsertVectors(records, namespace, options = {}) {
  if (!Array.isArray(records) || records.length === 0) {
    return { upsertedCount: 0, batches: 0 };
  }

  records.forEach(validatePineconeRecord);

  const config = getVectorStoreConfig();
  const targetNamespace = namespace || config.namespace;
  const batchSize = Number(options.batchSize || config.batchSize);

  // Divide em lotes
  const batches = [];
  for (let i = 0; i < records.length; i += batchSize) {
    batches.push(records.slice(i, i + batchSize));
  }

  const useMock = isMockMode(options);

  for (const batch of batches) {
    await withRetry(async () => {
      if (typeof options.customAdapter === 'function') {
        return options.customAdapter(batch);
      }

      if (useMock) {
        if (!mockStore.has(targetNamespace)) {
          mockStore.set(targetNamespace, new Map());
        }
        const nsMap = mockStore.get(targetNamespace);
        for (const record of batch) {
          // Idempotente: atualiza se já existir, insere se novo
          nsMap.set(record.id, record);
        }
        return { count: batch.length };
      }

      const namespaceIndex = getNamespace(targetNamespace);
      return namespaceIndex.upsert(batch);
    }, options);
  }

  return {
    upsertedCount: records.length,
    batches: batches.length,
    namespace: targetNamespace,
    indexName: config.indexName,
  };
}

function cosineSimilarity(vecA, vecB) {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i += 1) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dotProduct / denom;
}

async function queryVectors(vector, options = {}) {
  validateVector(vector);

  const config = getVectorStoreConfig();
  const namespace = options.namespace || config.namespace;
  const topK = options.topK || 5;

  if (isMockMode(options)) {
    const nsMap = mockStore.get(namespace) || new Map();
    const scored = [];

    for (const record of nsMap.values()) {
      const score = cosineSimilarity(vector, record.values);
      scored.push({
        id: record.id,
        score,
        values: options.includeValues ? record.values : undefined,
        metadata: options.includeMetadata !== false ? record.metadata : undefined,
      });
    }

    scored.sort((a, b) => b.score - a.score);

    return {
      matches: scored.slice(0, topK),
      namespace,
    };
  }

  const namespaceIndex = getNamespace(namespace);

  return namespaceIndex.query({
    vector,
    topK,
    includeMetadata: options.includeMetadata !== false,
    includeValues: options.includeValues || false,
    filter: options.filter && Object.keys(options.filter).length > 0 ? options.filter : undefined,
  });
}

async function describeIndexStats(options = {}) {
  const config = getVectorStoreConfig();

  if (isMockMode(options)) {
    const namespaces = {};
    let totalRecordCount = 0;

    for (const [ns, map] of mockStore.entries()) {
      namespaces[ns] = { recordCount: map.size };
      totalRecordCount += map.size;
    }

    return {
      namespaces,
      totalRecordCount,
      dimension: config.dimension,
      indexFullness: 0,
    };
  }

  const index = getPineconeIndex();
  return index.describeIndexStats();
}

module.exports = {
  describeIndexStats,
  getVectorStoreConfig,
  queryVectors,
  resetMockStore,
  sanitizeErrorMessage,
  upsertVectors,
  validatePineconeRecord,
  validateVector,
};
