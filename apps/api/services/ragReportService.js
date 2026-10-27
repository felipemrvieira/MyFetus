/**
 * Relatórios operacionais da ingestão do RAG.
 *
 * Os relatórios são deliberadamente limitados a metadados de execução. Eles
 * não armazenam texto de chunks, prompts, embeddings ou dados de pacientes.
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_REPORT_DIR = path.join(__dirname, '..', 'data', 'rag-reports');
const REPORT_VERSION = '1.0.0';

function sanitizeErrorMessage(message) {
  return String(message || 'Falha não especificada')
    .replace(/(api[_-]?key\s*[:=]\s*)[^\s,;&]+/gi, '$1[REDACTED]')
    .replace(/(Bearer\s+)[^\s,;&]+/gi, '$1[REDACTED]')
    .replace(/pc_key_[a-zA-Z0-9_-]+/gi, '[REDACTED]')
    .replace(/https?:\/\/[^\s]+/gi, '[URL_REDACTED]');
}

function normalizeResult(result = {}) {
  return {
    fileName: result.fileName,
    documentId: result.documentId,
    title: result.title,
    year: result.year,
    edition: result.edition,
    sha256: result.sha256,
    chunks: Number(result.chunks || 0),
    vectors: Number(result.vectors || 0),
    status: result.status || 'unknown',
  };
}

function buildIngestionReport(result = {}, options = {}) {
  return {
    reportVersion: REPORT_VERSION,
    generatedAt: options.generatedAt || new Date().toISOString(),
    namespace: result.namespace || options.namespace || 'guidelines',
    manifestVersion: result.manifestVersion || null,
    durationMs: Number(result.durationMs || 0),
    documents: Number(result.documents || 0),
    skippedCount: Number(result.skippedCount || 0),
    upsertedCount: Number(result.upsertedCount || 0),
    results: Array.isArray(result.results) ? result.results.map(normalizeResult) : [],
    failures: Array.isArray(result.failures)
      ? result.failures.map((failure) => ({
        fileName: failure.fileName,
        documentId: failure.documentId,
        code: failure.code || 'INGESTION_FAILED',
        message: sanitizeErrorMessage(failure.message),
      }))
      : [],
  };
}

function reportFileName(generatedAt = new Date().toISOString()) {
  return `ingestion-${generatedAt.replace(/[-:.TZ]/g, '').slice(0, 14)}.json`;
}

function writeIngestionReport(report, reportPathOrDir = DEFAULT_REPORT_DIR) {
  const target = reportPathOrDir.endsWith('.json')
    ? reportPathOrDir
    : path.join(reportPathOrDir, reportFileName(report.generatedAt));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return target;
}

function listReports(reportDir = DEFAULT_REPORT_DIR) {
  if (!fs.existsSync(reportDir)) return [];
  return fs.readdirSync(reportDir)
    .filter((fileName) => /^ingestion-.*\.json$/.test(fileName))
    .map((fileName) => path.join(reportDir, fileName))
    .sort();
}

function readReport(reportPath) {
  try {
    return JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  } catch (error) {
    return null;
  }
}

function getLatestReport(reportDir = DEFAULT_REPORT_DIR) {
  const reports = listReports(reportDir)
    .map(readReport)
    .filter(Boolean)
    .sort((left, right) => String(right.generatedAt).localeCompare(String(left.generatedAt)));
  return reports[0] || null;
}

function buildIngestionStats({ indexStats = null, checkpoint = { documents: {} }, reportDir = DEFAULT_REPORT_DIR } = {}) {
  const latestReport = getLatestReport(reportDir);
  const documents = latestReport?.results || Object.entries(checkpoint.documents || {}).map(([documentId, entry]) => ({
    documentId,
    sha256: entry.sha256,
    vectors: Number(entry.vectorCount || 0),
    status: 'checkpoint',
  }));

  return {
    reportVersion: REPORT_VERSION,
    generatedAt: new Date().toISOString(),
    namespace: latestReport?.namespace || null,
    manifestVersion: latestReport?.manifestVersion || null,
    index: indexStats,
    ingestion: {
      latestReportAt: latestReport?.generatedAt || null,
      documents: documents.map(normalizeResult),
      documentCount: documents.length,
      chunkCount: documents.reduce((total, document) => total + Number(document.chunks || 0), 0),
      vectorCount: documents.reduce((total, document) => total + Number(document.vectors || 0), 0),
      failures: latestReport?.failures || [],
    },
  };
}

module.exports = {
  DEFAULT_REPORT_DIR,
  REPORT_VERSION,
  buildIngestionReport,
  buildIngestionStats,
  getLatestReport,
  listReports,
  readReport,
  sanitizeErrorMessage,
  writeIngestionReport,
};
