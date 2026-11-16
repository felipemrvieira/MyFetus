const db = require('../backend');
const cryptoService = require('../services/cryptoService');
const { audit } = require('../services/auditService');
const { sendInternalError } = require('../utils/httpErrors');
const {
  FhirExportError,
  getFhirExport,
  validatePregnancyId,
} = require('../services/fhirExportService');
const { ensureCanAccessPregnancy } = require('../utils/clinicalAccess');

async function getFhirExportBundle(req, res) {
  try {
    const pregnancyId = validatePregnancyId(req.params.pregnancyId);
    if (!(await ensureCanAccessPregnancy(req, res, pregnancyId))) return;

    const bundle = await getFhirExport(db, {
      pregnancyId,
      crypto: cryptoService,
    });
    audit(req, {
      action: 'FHIR_EXPORT_GENERATED',
      resource: 'fhir_export',
      resource_id: bundle.id,
      detail: {
        pregnancy_id: pregnancyId,
        version: bundle.identifier.value,
        observation_count: bundle.entry.length - 1,
      },
    });
    if (req.accepts('application/fhir+json')) {
      res.type('application/fhir+json');
    }
    return res.json(bundle);
  } catch (error) {
    if (error instanceof FhirExportError) {
      const safeMessages = {
        FHIR_EXPORT_INVALID: 'pregnancy_id invalido',
        PREGNANCY_NOT_FOUND: 'Gestacao nao encontrada',
      };
      return res.status(error.status).json({
        error: safeMessages[error.code] || 'Requisicao invalida',
        code: error.code,
      });
    }
    return sendInternalError(res);
  }
}

module.exports = { getFhirExportBundle };
