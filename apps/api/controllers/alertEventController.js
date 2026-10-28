const client = require('../backend');
const { audit } = require('../services/auditService');
const { ensureCanAccessPregnancy } = require('../utils/clinicalAccess');
const { sendInternalError } = require('../utils/httpErrors');
const {
  AlertEventValidationError,
  acknowledgeAlert,
  closeAlert,
  serializeAlertEvent,
} = require('../services/alertEventService');

function validationError(res, error) {
  if (error instanceof AlertEventValidationError) {
    return res.status(400).json({ error: error.validationMessage });
  }
  return null;
}

async function listAlertEvents(req, res) {
  try {
    const pregnancyId = Number(req.params.pregnancyId);
    if (!Number.isInteger(pregnancyId) || pregnancyId <= 0) return res.status(400).json({ error: 'pregnancy_id invalido' });
    if (!(await ensureCanAccessPregnancy(req, res, pregnancyId))) return;
    const result = await client.query(
      `SELECT * FROM alert_events
       WHERE pregnancy_id = $1
       ORDER BY CASE status WHEN 'open' THEN 0 WHEN 'acknowledged' THEN 1 ELSE 2 END,
                last_seen_at DESC
       LIMIT 500`,
      [pregnancyId]
    );
    return res.json({ pregnancy_id: pregnancyId, events: result.rows.map(serializeAlertEvent) });
  } catch (error) {
    return sendInternalError(res);
  }
}

async function acknowledge(req, res) {
  try {
    const result = await acknowledgeAlert(client, Number(req.params.alertId), req.user.id);
    if (!result) return res.status(404).json({ error: 'Alerta não encontrado ou já encerrado' });
    audit(req, { action: 'ALERT_ACKNOWLEDGED', resource: 'alert_events', resource_id: String(result.id), detail: { status: result.status } });
    return res.json(result);
  } catch (error) {
    return validationError(res, error) || sendInternalError(res);
  }
}

async function close(req, res) {
  try {
    const result = await closeAlert(client, Number(req.params.alertId), req.user.id, req.body?.justification);
    if (!result) return res.status(404).json({ error: 'Alerta não encontrado ou já encerrado' });
    audit(req, { action: 'ALERT_CLOSED', resource: 'alert_events', resource_id: String(result.id), detail: { status: result.status } });
    return res.json(result);
  } catch (error) {
    return validationError(res, error) || sendInternalError(res);
  }
}

module.exports = { acknowledge, close, listAlertEvents };
