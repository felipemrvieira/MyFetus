const db = require('../backend');
const cryptoService = require('../services/cryptoService');
const { audit } = require('../services/auditService');
const { doctorCanAccessPregnant } = require('../utils/clinicalAccess');
const { sendInternalError } = require('../utils/httpErrors');
const {
  DocumentReportConflictError,
  DocumentReportNotFoundError,
  DocumentReportValidationError,
  createReport,
  findDocument,
  findReport,
  listReports,
  publishReport,
  validateId,
} = require('../services/documentReportService');

function errorBody(error) {
  if (error instanceof DocumentReportValidationError) {
    return { status: 400, body: { error: error.message } };
  }
  if (error instanceof DocumentReportConflictError) {
    return { status: 409, body: { error: error.message } };
  }
  if (error instanceof DocumentReportNotFoundError) {
    return { status: 404, body: { error: error.message } };
  }
  return null;
}

async function authorizeDocumentOwner(req, res, document) {
  if (!document) {
    res.status(404).json({ error: 'Documento nao encontrado' });
    return false;
  }
  if (req.user?.role === 'medico') {
    if (await doctorCanAccessPregnant(req.user.id, document.pregnant_id)) return true;
    res.status(403).json({ error: 'Medico nao vinculado a esta gestante' });
    return false;
  }
  if (req.user?.role === 'gestante') {
    const result = await db.query(
      'SELECT 1 FROM pregnants WHERE id = $1 AND user_id = $2 LIMIT 1',
      [document.pregnant_id, req.user.id]
    );
    if (result.rows.length > 0) return true;
    res.status(403).json({ error: 'Acesso negado a esta gestante' });
    return false;
  }
  res.status(403).json({ error: 'Perfil de usuario nao autorizado' });
  return false;
}

async function getDocumentReports(req, res) {
  try {
    const documentId = validateId(req.params.documentId, 'document_id');
    const document = await findDocument(db, documentId);
    if (!(await authorizeDocumentOwner(req, res, document))) return;
    const reports = await listReports(db, {
      documentId,
      role: req.user.role,
      crypto: cryptoService,
    });
    if (req.user.role === 'gestante' && reports[0]) {
      audit(req, {
        action: 'DOCUMENT_REPORT_VIEWED',
        resource: 'document_reports',
        resource_id: reports[0].id,
        detail: { document_id: documentId, pregnant_id: document.pregnant_id },
      });
    }
    return res.json(reports);
  } catch (error) {
    const mapped = errorBody(error);
    if (mapped) return res.status(mapped.status).json(mapped.body);
    return sendInternalError(res);
  }
}

async function createDocumentReport(req, res) {
  try {
    const documentId = validateId(req.params.documentId, 'document_id');
    const document = await findDocument(db, documentId);
    if (!(await authorizeDocumentOwner(req, res, document))) return;
    if (req.user.role !== 'medico') {
      return res.status(403).json({ error: 'Apenas medico pode criar devolutiva' });
    }
    const report = await createReport(db, {
      documentId,
      authorUserId: req.user.id,
      payload: req.body || {},
      crypto: cryptoService,
    });
    audit(req, {
      action: 'DOCUMENT_REPORT_CREATED',
      resource: 'document_reports',
      resource_id: report.id,
      detail: {
        document_id: documentId,
        pregnant_id: document.pregnant_id,
        version: report.version,
        status: report.status,
        severity: report.severity,
      },
    });
    return res.status(201).json(report);
  } catch (error) {
    const mapped = errorBody(error);
    if (mapped) return res.status(mapped.status).json(mapped.body);
    return sendInternalError(res);
  }
}

async function publishDocumentReport(req, res) {
  try {
    const reportId = validateId(req.params.reportId, 'report_id');
    const stored = await findReport(db, reportId);
    if (!stored) return res.status(404).json({ error: 'Devolutiva nao encontrada' });
    if (!(await authorizeDocumentOwner(req, res, { pregnant_id: stored.pregnant_id }))) return;
    if (req.user.role !== 'medico') {
      return res.status(403).json({ error: 'Apenas medico pode publicar devolutiva' });
    }
    const report = await publishReport(db, { reportId, crypto: cryptoService });
    audit(req, {
      action: 'DOCUMENT_REPORT_PUBLISHED',
      resource: 'document_reports',
      resource_id: report.id,
      detail: {
        document_id: report.document_id,
        pregnant_id: report.pregnant_id,
        version: report.version,
        severity: report.severity,
      },
    });
    return res.json(report);
  } catch (error) {
    const mapped = errorBody(error);
    if (mapped) return res.status(mapped.status).json(mapped.body);
    return sendInternalError(res);
  }
}

module.exports = {
  createDocumentReport,
  getDocumentReports,
  publishDocumentReport,
};
