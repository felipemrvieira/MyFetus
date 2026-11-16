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
const { generatePregnancyReportPdf } = require('../services/pregnancyReportPdfService');

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

async function getPregnancyReportPdf(req, res) {
  let pregnancyId;
  try {
    pregnancyId = validateId(req.params.pregnancyId, 'pregnancy_id');
    if (!(await ensureCanAccessPregnancy(req, res, pregnancyId))) return;

    const snapshot = await buildPregnancyReportSnapshot(db, {
      pregnancyId,
      crypto: cryptoService,
    });
    const pdf = await generatePregnancyReportPdf(snapshot);
    audit(req, {
      action: 'PREGNANCY_REPORT_PDF_GENERATED',
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
    res.set({
      'Cache-Control': 'no-store, private',
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="relatorio-gestacao-${pregnancyId}.pdf"`,
      'Content-Length': String(pdf.length),
      'X-Content-Type-Options': 'nosniff',
    });
    return res.send(pdf);
  } catch (error) {
    if (error instanceof PregnancyReportValidationError) {
      return res.status(400).json({ error: clientValidationMessage(error) });
    }
    if (error instanceof PregnancyReportNotFoundError) {
      return res.status(404).json({ error: 'Gestacao nao encontrada' });
    }
    return res.status(500).json({ error: 'Erro ao gerar PDF da gestacao' });
  }
}

async function recordPregnancyReportShare(req, res) {
  try {
    const pregnancyId = validateId(req.params.pregnancyId, 'pregnancy_id');
    if (!(await ensureCanAccessPregnancy(req, res, pregnancyId))) return;

    const outcome = String(req.body?.outcome || '').toUpperCase();
    if (!['SUCCESS', 'FAILURE'].includes(outcome)) {
      return res.status(400).json({ error: 'outcome invalido' });
    }
    const allowedReasons = new Set([
      'download_failed',
      'share_unavailable',
      'share_failed',
      'user_cancelled',
    ]);
    const reason = String(req.body?.reason || '');
    audit(req, {
      action: 'PREGNANCY_REPORT_SHARED',
      resource: 'pregnancy_report',
      resource_id: pregnancyId,
      outcome,
      detail: {
        pregnancy_id: pregnancyId,
        operation: 'system_share_sheet',
        ...(allowedReasons.has(reason) ? { reason } : {}),
      },
    });
    return res.status(204).send();
  } catch (error) {
    if (error instanceof PregnancyReportValidationError) {
      return res.status(400).json({ error: clientValidationMessage(error) });
    }
    return res.status(500).json({ error: 'Erro ao registrar compartilhamento' });
  }
}

module.exports = {
  getPregnancyReportPdf,
  getPregnancyReportSnapshot,
  recordPregnancyReportShare,
};
