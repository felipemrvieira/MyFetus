/**
 * embeddingService.js
 *
 * Gera vetores de embedding usando multilingual-e5-small (ou modelo configurável).
 * Permite configuração de modelo e dimensão via variáveis de ambiente
 * e suporte a modo mock determinístico para testes herméticos.
 */

const crypto = require('crypto');

function getEmbeddingConfig() {
  const model = process.env.RAG_EMBEDDING_MODEL || process.env.EMBEDDING_MODEL || 'Xenova/multilingual-e5-small';
  const dimension = Number(process.env.RAG_EMBEDDING_DIMENSION || process.env.EMBEDDING_DIMENSION || 384);
  return { model, dimension };
}

let extractorPromise = null;

async function getExtractor(model) {
  if (!extractorPromise) {
    extractorPromise = import('@huggingface/transformers')
      .then(({ pipeline }) => {
        return pipeline('feature-extraction', model);
      });
  }

  return extractorPromise;
}

function normalizeEmbeddingInput(text, inputType = 'passage') {
  const cleanText = String(text || '').trim();

  if (!cleanText) {
    throw new Error('Texto vazio não pode gerar embedding.');
  }

  // O modelo E5 usa prefixos específicos para passagens e perguntas.
  if (cleanText.startsWith('passage:') || cleanText.startsWith('query:')) {
    return cleanText;
  }

  return `${inputType}: ${cleanText}`;
}

/**
 * Gera embedding sintético determinístico baseado em hash SHA-256 para testes.
 */
function generateMockEmbedding(text, dimension) {
  const hash = crypto.createHash('sha256').update(text).digest();
  const vector = [];
  let sumSq = 0;

  for (let i = 0; i < dimension; i += 1) {
    const byte = hash[i % hash.length];
    const val = (byte / 127.5) - 1.0;
    vector.push(val);
    sumSq += val * val;
  }

  // Normalização L2
  const norm = Math.sqrt(sumSq) || 1;
  return vector.map((v) => parseFloat((v / norm).toFixed(6)));
}

async function generateEmbedding(text, inputType = 'passage', options = {}) {
  const formattedText = normalizeEmbeddingInput(text, inputType);
  const config = getEmbeddingConfig();
  const expectedDimension = Number(options.expectedDimension || config.dimension);

  const isMock = options.mock || process.env.EMBEDDING_MOCK === 'true';

  if (isMock) {
    const embedding = generateMockEmbedding(formattedText, config.dimension);
    if (embedding.length !== expectedDimension) {
      throw new Error(`Dimensão divergente: gerado ${embedding.length}, esperado ${expectedDimension}`);
    }
    return embedding;
  }

  const extractor = await getExtractor(config.model);
  const output = await extractor(formattedText, {
    pooling: 'mean',
    normalize: true,
  });

  const embedding = Array.from(output.data);

  if (embedding.length !== expectedDimension) {
    throw new Error(`Dimensão divergente: gerado ${embedding.length}, esperado ${expectedDimension}`);
  }

  return embedding;
}

async function generateEmbeddings(texts, inputType = 'passage', options = {}) {
  if (!Array.isArray(texts)) {
    throw new Error('generateEmbeddings espera uma lista de textos.');
  }

  const embeddings = [];

  for (const text of texts) {
    const embedding = await generateEmbedding(text, inputType, options);
    embeddings.push(embedding);
  }

  return embeddings;
}

module.exports = {
  generateEmbedding,
  generateEmbeddings,
  getEmbeddingConfig,
  normalizeEmbeddingInput,
};
