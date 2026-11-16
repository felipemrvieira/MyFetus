const db = require('../backend');
const cryptoService = require('../services/cryptoService');
const { audit } = require('../services/auditService');
const { ensureCanAccessPregnancy } = require('../utils/clinicalAccess');
const {
  PregnancyReportNotFoundError,
  PregnancyReportValidationError,
  buildPregnancyReportSnapshot,
  validateId,
} = require('../services/pregnancyReportService');

function clientValidationMessage(error) {
  return error instanceof PregnancyReportValidationError
    ? error.message
    : 'Requisicao invalida';
}

async function getPregnancyReportSnapshot(req, res) {
  let pregnancyId;
  try {
    pregnancyId = validateId(req.params.pregnancyId, 'pregnancy_id');
    if (!(await ensureCanAccessPregnancy(req, res, pregnancyId))) return;

    const snapshot = await buildPregnancyReportSnapshot(db, {
      pregnancyId,
      crypto: cryptoService,
    });
    audit(req, {
      action: 'PREGNANCY_REPORT_SNAPSHOT_GENERATED',
      resource: 'pregnancy_report',
      resource_id: pregnancyId,
      detail: {
        pregnancy_id: pregnancyId,
        report_version: snapshot.report_version,
        period: snapshot.period,
        counts: {
          exams: snapshot.exams.items.length,
          diary: snapshot.diary.items.length,
          alerts: snapshot.alerts.items.length,
          vaccines: snapshot.patient.vaccines.items.length,
        },
      },
    });
    res.set('Cache-Control', 'no-store');
    return res.json(snapshot);
  } catch (error) {
    if (error instanceof PregnancyReportValidationError) {
      return res.status(400).json({ error: clientValidationMessage(error) });
    }
    if (error instanceof PregnancyReportNotFoundError) {
      return res.status(404).json({ error: 'Gestacao nao encontrada' });
    }
    return res.status(500).json({ error: 'Erro ao gerar snapshot da gestacao' });
  }
}

module.exports = { getPregnancyReportSnapshot };
