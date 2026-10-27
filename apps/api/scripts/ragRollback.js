require('dotenv').config();

const {
  DEFAULT_CHECKPOINT_PATH,
  loadCheckpoint,
  saveCheckpoint,
} = require('../services/ragIngestionService');
const {
  deleteVectorsByDocument,
  getVectorStoreConfig,
} = require('../services/vectorStoreService');

async function main() {
  const documentId = process.argv[2];
  if (!documentId) {
    throw new Error('Uso: npm run rag:rollback -- <documentId>');
  }

  const config = getVectorStoreConfig();
  const result = await deleteVectorsByDocument(documentId, config.namespace);
  const checkpoint = loadCheckpoint();
  delete checkpoint.documents[documentId];
  saveCheckpoint(DEFAULT_CHECKPOINT_PATH, checkpoint);

  console.log(JSON.stringify({
    ...result,
    checkpointPath: DEFAULT_CHECKPOINT_PATH,
    nextStep: 'RAG_FORCE_INGEST=true npm run rag:ingest',
  }, null, 2));
}

main().catch((error) => {
  console.error('Erro no rollback da ingestão RAG:', error.message);
  process.exit(1);
});
