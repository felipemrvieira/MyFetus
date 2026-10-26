/**
 * ragIngestionService.js
 *
 * Orquestra a ingestão reproduzível e idempotente do RAG (E4-02.3):
 * Gate do manifesto -> PDF -> extração -> chunks determinísticos -> embeddings -> upsert Pinecone.
 *
 * Suporta checkpoint para resume automático após falha parcial e suprime
 * conteúdo clínico e chaves dos registros de log.
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');

const { createChunks } = require('./chunkingService');
const { generateEmbedding } = require('./embeddingService');
const { upsertVectors, getVectorStoreConfig } = require('./vectorStoreService');
const {
  assertIngestionAllowed,
  buildSourceMetadata,
  evaluateGuidelines,
  loadManifest,
} = require('./ragManifestGate');
const logger = require('../utils/logger');

const GUIDELINES_DIR = path.join(__dirname, '..', 'data', 'guidelines');
const DEFAULT_CHECKPOINT_PATH = path.join(__dirname, '..', 'data', '.rag-checkpoint.json');

function loadPdfTextExtractor() {
  const possiblePaths = [
    '../utils/pdfTextExtractor',
    '../services/pdfTextExtractor',
    './pdfTextExtractor',
  ];

  for (const extractorPath of possiblePaths) {
    try {
      return require(extractorPath);
    } catch (error) {
      // Tenta o próximo caminho.
    }
  }

  throw new Error(
    'Não foi possível encontrar pdfTextExtractor.js em utils ou services.'
  );
}

const { extractDocumentText } = loadPdfTextExtractor();

function listPdfFiles(guidelinesDir = GUIDELINES_DIR) {
  if (!fs.existsSync(guidelinesDir)) {
    throw new Error(`Pasta não encontrada: ${guidelinesDir}`);
  }

  return fs
    .readdirSync(guidelinesDir)
    .filter((fileName) => fileName.toLowerCase().endsWith('.pdf'));
}

function loadCheckpoint(checkpointPath = DEFAULT_CHECKPOINT_PATH) {
  if (!fs.existsSync(checkpointPath)) {
    return { documents: {} };
  }

  try {
    const raw = fs.readFileSync(checkpointPath, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed.documents === 'object' ? parsed : { documents: {} };
  } catch (err) {
    return { documents: {} };
  }
}

function saveCheckpoint(checkpointPath = DEFAULT_CHECKPOINT_PATH, checkpoint = { documents: {} }) {
  try {
    const dir = path.dirname(checkpointPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(checkpointPath, JSON.stringify(checkpoint, null, 2), 'utf8');
  } catch (err) {
    logger.warn('Ingestão RAG: falha ao salvar arquivo de checkpoint', {
      error: err.message,
    });
  }
}

function isDocumentIndexed(checkpoint, documentId, sha256) {
  if (!checkpoint || !checkpoint.documents) return false;
  const entry = checkpoint.documents[documentId];
  return Boolean(entry && entry.sha256 === sha256);
}

async function extractTextFromPdf(filePath, fileName) {
  const result = await extractDocumentText({
    file_path: filePath,
    document_name: fileName,
    document_type: 'application/pdf',
  });

  if (!result || !result.text || result.text.trim().length === 0) {
    throw new Error(`Não foi possível extrair texto de ${fileName}`);
  }

  return result;
}

function buildPineconeRecord(chunk, embedding, sourceMetadata) {
  return {
    id: chunk.id,
    values: embedding,
    metadata: {
      ...chunk.metadata,
      ...sourceMetadata,
      text: chunk.text,
    },
  };
}

async function ingestSingleDocument({ fileName, filePath, source }, manifestVersion, options = {}) {
  const sourceMetadata = buildSourceMetadata(source, manifestVersion);
  const config = getVectorStoreConfig();
  const targetNamespace = options.namespace || config.namespace;

  logger.info('Ingestão RAG: documento iniciado', {
    documentId: source.documentId,
    sha256: source.sha256,
  });

  const extractionResult = await extractTextFromPdf(filePath, fileName);

  const chunks = createChunks(extractionResult.pages || extractionResult.text, {
    source: source.title,
    documentId: source.documentId,
    title: source.title,
    year: source.year,
    edition: source.edition,
    section: (source.topics && source.topics[0]) || 'Geral',
    documentType: source.documentType,
  });

  logger.info('Ingestão RAG: chunks gerados', {
    documentId: source.documentId,
    chunksCount: chunks.length,
  });

  const records = [];

  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    const embedding = await generateEmbedding(chunk.text, 'passage', options);
    const record = buildPineconeRecord(chunk, embedding, sourceMetadata);
    records.push(record);
  }

  logger.info('Ingestão RAG: enviando vetores', {
    documentId: source.documentId,
    recordsCount: records.length,
    namespace: targetNamespace,
  });

  const upsertResult = await upsertVectors(records, targetNamespace, options);

  logger.info('Ingestão RAG: documento indexado com sucesso', {
    documentId: source.documentId,
    vectorsCount: upsertResult.upsertedCount,
    batches: upsertResult.batches,
  });

  return {
    fileName,
    source: source.title,
    documentId: source.documentId,
    title: source.title,
    year: source.year,
    edition: source.edition,
    sha256: source.sha256,
    chunks: chunks.length,
    vectors: upsertResult.upsertedCount,
  };
}

async function ingestGuidelines(options = {}) {
  const startTime = Date.now();
  const guidelinesDir = options.guidelinesDir || GUIDELINES_DIR;
  const manifest = options.manifest || loadManifest();
  const checkpointPath = options.checkpointPath || DEFAULT_CHECKPOINT_PATH;
  const force = Boolean(options.force);

  // O gate roda antes de qualquer extração ou embedding: fonte não aprovada
  // ou com hash diferente do manifesto interrompe a ingestão inteira (fail-closed).
  const gate = assertIngestionAllowed(
    evaluateGuidelines({ guidelinesDir, manifest })
  );

  const config = getVectorStoreConfig();
  const namespace = options.namespace || config.namespace;

  logger.info('Ingestão RAG: PDFs liberados pelo manifesto', {
    fileCount: gate.approved.length,
    manifestVersion: gate.manifestVersion,
    namespace,
  });

  const checkpoint = loadCheckpoint(checkpointPath);
  const results = [];
  let skippedCount = 0;
  let upsertedCount = 0;

  for (const document of gate.approved) {
    const { source } = document;
    const alreadyIndexed = isDocumentIndexed(checkpoint, source.documentId, source.sha256);

    if (alreadyIndexed && !force) {
      logger.info('Ingestão RAG: documento já indexado no checkpoint, pulando', {
        documentId: source.documentId,
      });

      const cached = checkpoint.documents[source.documentId];
      results.push({
        fileName: document.fileName,
        documentId: source.documentId,
        sha256: source.sha256,
        status: 'skipped',
        vectors: cached.vectorCount || 0,
      });
      skippedCount += 1;
      continue;
    }

    // Processa documento e grava checkpoint incremental
    const docResult = await ingestSingleDocument(document, gate.manifestVersion, options);

    checkpoint.documents[source.documentId] = {
      sha256: source.sha256,
      completedAt: new Date().toISOString(),
      vectorCount: docResult.vectors,
    };
    saveCheckpoint(checkpointPath, checkpoint);

    results.push({
      ...docResult,
      status: 'indexed',
    });
    upsertedCount += docResult.vectors;
  }

  const durationMs = Date.now() - startTime;

  return {
    namespace,
    manifestVersion: gate.manifestVersion,
    documents: results.length,
    skippedCount,
    upsertedCount,
    durationMs,
    results,
  };
}

module.exports = {
  DEFAULT_CHECKPOINT_PATH,
  ingestGuidelines,
  ingestSingleDocument,
  isDocumentIndexed,
  listPdfFiles,
  loadCheckpoint,
  saveCheckpoint,
};
