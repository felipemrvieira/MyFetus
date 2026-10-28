const client = require('../backend');
const { audit } = require('../services/auditService');
const { ensureCanAccessPregnancy } = require('../utils/clinicalAccess');
const { sendInternalError } = require('../utils/httpErrors');
const { syncAcceptedClinicalObservations } = require('../services/clinicalRiskIntegrationService');

async function syncExamObservations(req, res) {
  try {
    const pregnancyId = Number(req.params.pregnancyId);
    if (!Number.isInteger(pregnancyId) || pregnancyId <= 0) return res.status(400).json({ error: 'pregnancy_id invalido' });
    const pregnancy = await ensureCanAccessPregnancy(req, res, pregnancyId);
    if (!pregnancy) return;
    if (!Array.isArray(req.body?.observations)) return res.status(400).json({ error: 'observations deve ser uma lista' });
    const result = await syncAcceptedClinicalObservations(client, req.body.observations, {
      pregnancyId,
      pregnantId: pregnancy.pregnant_id,
      gestationalWeeks: Number(req.body.gestational_weeks || 0),
    });
    audit(req, {
      action: 'CLINICAL_RISK_RECALCULATED',
      resource: 'alert_events',
      resource_id: String(pregnancyId),
      detail: { accepted_count: result.accepted_count, ignored_count: result.ignored_count, status: result.status },
    });
    return res.json({ pregnancy_id: pregnancyId, ...result });
  } catch (error) {
    return sendInternalError(res);
  }
}

module.exports = { syncExamObservations };
