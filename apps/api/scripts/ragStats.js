require('dotenv').config();

const {
  DEFAULT_CHECKPOINT_PATH,
  loadCheckpoint,
} = require('../services/ragIngestionService');
const {
  DEFAULT_REPORT_DIR,
  buildIngestionStats,
} = require('../services/ragReportService');
const {
  describeIndexStats,
  getVectorStoreConfig,
} = require('../services/vectorStoreService');

async function main() {
  const config = getVectorStoreConfig();
  const indexStats = await describeIndexStats();
  const stats = buildIngestionStats({
    indexStats,
    checkpoint: loadCheckpoint(),
    reportDir: process.env.RAG_REPORT_DIR || DEFAULT_REPORT_DIR,
  });

  console.log(JSON.stringify({
    ...stats,
    namespace: stats.namespace || config.namespace,
    checkpointPath: DEFAULT_CHECKPOINT_PATH,
    reportDir: process.env.RAG_REPORT_DIR || DEFAULT_REPORT_DIR,
  }, null, 2));
}

main().catch((error) => {
  console.error('Erro ao obter estatísticas da ingestão RAG:', error.message);
  process.exit(1);
});
