/**
 * Caminho único de retrieval do RAG.
 *
 * Este serviço recebe somente a pergunta e filtros de fontes aprovadas. Dados
 * clínicos de pacientes não fazem parte do contrato de retrieval; quando uma
 * análise precisa de contexto clínico, a autorização é feita pelo controller
 * antes de o contexto seguir para o agente/generation.
 */

const embeddingService = require('./embeddingService');
const vectorStoreService = require('./vectorStoreService');

const ALLOWED_FILTER_FIELDS = new Set([
  'documentId',
  'title',
  'source',
  'issuer',
  'language',
  'documentType',
  'manifestVersion',
  'section',
  'page',
  'year',
]);
const ALLOWED_FILTER_OPERATORS = new Set(['$eq', '$in', '$and', '$or']);

class RagRetrievalError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'RagRetrievalError';
    this.code = code;
    this.details = details;
  }
}

function validateTopK(topK) {
  if (!Number.isInteger(topK) || topK < 1 || topK > 20) {
    throw new RagRetrievalError('INVALID_TOP_K', 'topK deve ser um inteiro entre 1 e 20.');
  }
}

function validateFilterNode(node) {
  if (!node || typeof node !== 'object' || Array.isArray(node)) {
    throw new RagRetrievalError('INVALID_FILTER', 'Filtros de retrieval devem ser objetos.');
  }

  for (const [key, value] of Object.entries(node)) {
    if (key.startsWith('$')) {
      if (!ALLOWED_FILTER_OPERATORS.has(key)) {
        throw new RagRetrievalError('INVALID_FILTER', `Operador de filtro não permitido: ${key}.`);
      }
      if (key === '$or' || key === '$and') {
        if (!Array.isArray(value) || value.length === 0) {
          throw new RagRetrievalError('INVALID_FILTER', `${key} precisa receber uma lista não vazia.`);
        }
        value.forEach(validateFilterNode);
      }
      continue;
    }

    if (!ALLOWED_FILTER_FIELDS.has(key)) {
      throw new RagRetrievalError('INVALID_FILTER', `Campo de filtro não permitido: ${key}.`);
    }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const operator of Object.keys(value)) {
        if (!ALLOWED_FILTER_OPERATORS.has(operator) || operator === '$and' || operator === '$or') {
          throw new RagRetrievalError('INVALID_FILTER', `Operador inválido para ${key}.`);
        }
      }
    }
  }
}

function normalizeFilters(filters = {}) {
  if (!filters || Object.keys(filters).length === 0) return undefined;
  validateFilterNode(filters);
  return filters;
}

function mapMatch(match) {
  const metadata = match?.metadata || {};
  return {
    trecho: typeof metadata.text === 'string' ? metadata.text : '',
    fonte: metadata.source || metadata.title || metadata.issuer || null,
    pagina: metadata.page ?? null,
    secao: metadata.section ?? null,
    relevancia: Number(Number(match.score || 0).toFixed(4)),
    documento_id: metadata.documentId || null,
    idioma: metadata.language || null,
    tipo_documento: metadata.documentType || null,
  };
}

async function retrieve({ query, topK = 5, filters = {}, namespace, includeValues = false } = {}) {
  if (typeof query !== 'string' || query.trim().length === 0) {
    throw new RagRetrievalError('EMPTY_QUERY', 'query não pode estar vazia.');
  }
  validateTopK(topK);
  const normalizedFilters = normalizeFilters(filters);
  const config = vectorStoreService.getVectorStoreConfig();
  const targetNamespace = namespace || config.namespace;

  let queryEmbedding;
  try {
    queryEmbedding = await embeddingService.generateEmbedding(query, 'query');
  } catch (error) {
    throw new RagRetrievalError('EMBEDDING_UNAVAILABLE', 'Não foi possível preparar a busca.', {
      cause: error.message,
    });
  }

  let vectorResult;
  try {
    vectorResult = await vectorStoreService.queryVectors(queryEmbedding, {
      namespace: targetNamespace,
      topK,
      filter: normalizedFilters,
      includeMetadata: true,
      includeValues,
    });
  } catch (error) {
    throw new RagRetrievalError('VECTOR_STORE_UNAVAILABLE', 'A base de conhecimento está indisponível.', {
      cause: error.message,
      namespace: targetNamespace,
    });
  }

  const resultados = (vectorResult.matches || []).map(mapMatch);
  return {
    status: resultados.length > 0 ? 'ok' : 'empty',
    namespace: targetNamespace,
    topK,
    filtros: normalizedFilters || {},
    resultados,
  };
}

async function retrieveChunks(query, topK = 5, filters = {}) {
  const result = await retrieve({ query, topK, filters });
  return result.resultados;
}

module.exports = {
  ALLOWED_FILTER_FIELDS,
  RagRetrievalError,
  mapMatch,
  normalizeFilters,
  retrieve,
  retrieveChunks,
  validateFilterNode,
};
