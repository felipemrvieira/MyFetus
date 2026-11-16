const STATUS = Object.freeze({
  IN_REVIEW: 'in_review',
  PUBLISHED: 'published',
  REPLACED: 'replaced',
});

const SEVERITIES = Object.freeze([
  'normal',
  'attention',
  'see_consultation',
  'seek_care_today',
]);

const MAX_CONTENT_LENGTH = 5000;
const APPROVED_GUIDANCE = Object.freeze({
  attention: 'Esta orientação não é diagnóstico nem prescrição. Procure seu serviço de saúde conforme orientação do médico.',
  see_consultation: 'Esta orientação não é diagnóstico nem prescrição. Procure seu serviço de saúde conforme orientação do médico.',
  seek_care_today: 'Seu exame precisa de avaliação hoje. Procure a maternidade.',
});

class DocumentReportValidationError extends Error {}
class DocumentReportNotFoundError extends Error {}
class DocumentReportConflictError extends Error {}

function validateId(value, field = 'id') {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw new DocumentReportValidationError(`${field} invalido`);
  }
  return id;
}

function normalizeSeverity(value) {
  if (typeof value !== 'string' || !SEVERITIES.includes(value)) {
    throw new DocumentReportValidationError('severity invalido');
  }
  return value;
}

function normalizeContent(value) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new DocumentReportValidationError('content e obrigatorio');
  }
  const content = value.trim();
  if (content.length > MAX_CONTENT_LENGTH) {
    throw new DocumentReportValidationError(`content excede o limite de ${MAX_CONTENT_LENGTH} caracteres`);
  }
  return content;
}

function validateCreatePayload(payload = {}) {
  const severity = normalizeSeverity(payload.severity);
  const content = normalizeContent(payload.content);
  const guidance = APPROVED_GUIDANCE[severity];
  const enrichedContent = guidance && !content.includes(guidance)
    ? `${content}\n\n${guidance}`
    : content;
  if (enrichedContent.length > MAX_CONTENT_LENGTH) {
    throw new DocumentReportValidationError(`content excede o limite de ${MAX_CONTENT_LENGTH} caracteres`);
  }
  return {
    severity,
    content: enrichedContent,
  };
}

function toPublicReport(row, crypto) {
  const decrypted = crypto.decryptRecord(row, 'document_reports');
  return {
    id: Number(row.id),
    document_id: Number(row.document_id),
    pregnant_id: Number(row.pregnant_id),
    author_user_id: Number(row.author_user_id),
    version: Number(row.version),
    status: row.status,
    severity: decrypted.severity,
    content: decrypted.content,
    supersedes_report_id: row.supersedes_report_id ? Number(row.supersedes_report_id) : null,
    published_at: row.published_at || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function findDocument(db, documentId) {
  const result = await db.query(
    'SELECT id, pregnant_id FROM pregnant_documents WHERE id = $1',
    [documentId]
  );
  return result.rows[0] || null;
}

async function findReport(db, reportId) {
  const result = await db.query(
    `SELECT id, document_id, pregnant_id, author_user_id, version, status,
            severity, content, supersedes_report_id, published_at, created_at, updated_at
       FROM document_reports
      WHERE id = $1`,
    [reportId]
  );
  return result.rows[0] || null;
}

async function listReports(db, { documentId, role, crypto }) {
  const query = role === 'gestante'
    ? `SELECT id, document_id, pregnant_id, author_user_id, version, status,
              severity, content, supersedes_report_id, published_at, created_at, updated_at
         FROM document_reports
        WHERE document_id = $1 AND status = 'published'
        ORDER BY version DESC
        LIMIT 1`
    : `SELECT id, document_id, pregnant_id, author_user_id, version, status,
              severity, content, supersedes_report_id, published_at, created_at, updated_at
         FROM document_reports
        WHERE document_id = $1
        ORDER BY version DESC`;
  const result = await db.query(query, [documentId]);
  return result.rows.map((row) => toPublicReport(row, crypto));
}

async function createReport(db, { documentId: documentIdValue, authorUserId, payload, crypto }) {
  const documentId = validateId(documentIdValue, 'document_id');
  const userId = validateId(authorUserId, 'author_user_id');
  const values = validateCreatePayload(payload);
  const connection = await db.connect();
  let committed = false;
  try {
    await connection.query('BEGIN');
    const document = await findDocument(connection, documentId);
    if (!document) throw new DocumentReportNotFoundError('Documento nao encontrado');

    const versionResult = await connection.query(
      'SELECT COALESCE(MAX(version), 0) + 1 AS next_version FROM document_reports WHERE document_id = $1',
      [documentId]
    );
    const previousResult = await connection.query(
      `SELECT id FROM document_reports
        WHERE document_id = $1 AND status = 'published'
        ORDER BY version DESC LIMIT 1`,
      [documentId]
    );
    const encrypted = crypto.encryptRecord(values, 'document_reports');
    const result = await connection.query(
      `INSERT INTO document_reports (
         document_id, pregnant_id, author_user_id, version, status,
         severity, content, supersedes_report_id, encryption_key_version
       ) VALUES ($1, $2, $3, $4, 'in_review', $5, $6, $7, $8)
       RETURNING id, document_id, pregnant_id, author_user_id, version, status,
                 severity, content, supersedes_report_id, published_at, created_at, updated_at`,
      [
        documentId,
        document.pregnant_id,
        userId,
        Number(versionResult.rows[0].next_version),
        encrypted.severity,
        encrypted.content,
        previousResult.rows[0]?.id || null,
        crypto.currentVersion || crypto.getCurrentVersion(),
      ]
    );
    await connection.query('COMMIT');
    committed = true;
    return toPublicReport(result.rows[0], crypto);
  } finally {
    if (!committed) {
      try { await connection.query('ROLLBACK'); } catch (_) { /* preserve original error */ }
    }
    connection.release();
  }
}

async function publishReport(db, { reportId: reportIdValue, crypto }) {
  const reportId = validateId(reportIdValue, 'report_id');
  const connection = await db.connect();
  let committed = false;
  try {
    await connection.query('BEGIN');
    const currentResult = await connection.query(
      `SELECT id, document_id, pregnant_id, author_user_id, version, status,
              severity, content, supersedes_report_id, published_at, created_at, updated_at
         FROM document_reports
        WHERE id = $1
        FOR UPDATE`,
      [reportId]
    );
    const current = currentResult.rows[0];
    if (!current) throw new DocumentReportNotFoundError('Devolutiva nao encontrada');
    if (current.status !== STATUS.IN_REVIEW) {
      throw new DocumentReportConflictError('A devolutiva nao esta em revisao');
    }

    await connection.query(
      `UPDATE document_reports
          SET status = 'replaced', updated_at = CURRENT_TIMESTAMP
        WHERE document_id = $1 AND status = 'published' AND id <> $2`,
      [current.document_id, reportId]
    );
    const result = await connection.query(
      `UPDATE document_reports
          SET status = 'published', published_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
        RETURNING id, document_id, pregnant_id, author_user_id, version, status,
                  severity, content, supersedes_report_id, published_at, created_at, updated_at`,
      [reportId]
    );
    await connection.query('COMMIT');
    committed = true;
    return toPublicReport(result.rows[0], crypto);
  } finally {
    if (!committed) {
      try { await connection.query('ROLLBACK'); } catch (_) { /* preserve original error */ }
    }
    connection.release();
  }
}

module.exports = {
  DocumentReportConflictError,
  DocumentReportNotFoundError,
  DocumentReportValidationError,
  MAX_CONTENT_LENGTH,
  APPROVED_GUIDANCE,
  SEVERITIES,
  STATUS,
  createReport,
  findDocument,
  findReport,
  listReports,
  normalizeContent,
  normalizeSeverity,
  publishReport,
  toPublicReport,
  validateCreatePayload,
  validateId,
};
