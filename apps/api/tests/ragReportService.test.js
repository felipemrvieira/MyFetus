const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  buildIngestionReport,
  buildIngestionStats,
  getLatestReport,
  writeIngestionReport,
} = require('../services/ragReportService');

test('relatório de ingestão contém métricas operacionais sem texto clínico', () => {
  const report = buildIngestionReport({
    namespace: 'guidelines',
    manifestVersion: '1.0.0',
    durationMs: 42,
    documents: 1,
    upsertedCount: 3,
    results: [{
      fileName: 'manual.pdf',
      documentId: 'manual',
      title: 'Manual sintético',
      year: 2026,
      chunks: 3,
      vectors: 3,
      status: 'indexed',
      text: 'não deve aparecer',
    }],
    failures: [{
      documentId: 'manual',
      message: 'Bearer secret-token',
    }],
  }, { generatedAt: '2026-10-27T12:00:00.000Z' });

  assert.equal(report.reportVersion, '1.0.0');
  assert.equal(report.upsertedCount, 3);
  assert.equal(report.results[0].vectors, 3);
  assert.equal(report.results[0].text, undefined);
  assert.equal(report.failures[0].message, 'Bearer [REDACTED]');
});

test('stats agrega documentos, chunks e vetores do relatório mais recente', () => {
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rag-reports-'));
  try {
    writeIngestionReport({
      reportVersion: '1.0.0',
      generatedAt: '2026-10-27T12:00:00.000Z',
      namespace: 'guidelines',
      manifestVersion: '1.0.0',
      durationMs: 10,
      documents: 2,
      results: [
        { documentId: 'a', chunks: 2, vectors: 2, status: 'indexed' },
        { documentId: 'b', chunks: 1, vectors: 1, status: 'skipped' },
      ],
      failures: [],
    }, reportDir);

    const stats = buildIngestionStats({
      indexStats: { namespaces: { guidelines: { recordCount: 3 } } },
      reportDir,
    });

    assert.equal(getLatestReport(reportDir).namespace, 'guidelines');
    assert.equal(stats.ingestion.documentCount, 2);
    assert.equal(stats.ingestion.chunkCount, 3);
    assert.equal(stats.ingestion.vectorCount, 3);
    assert.equal(stats.index.namespaces.guidelines.recordCount, 3);
  } finally {
    fs.rmSync(reportDir, { recursive: true, force: true });
  }
});
