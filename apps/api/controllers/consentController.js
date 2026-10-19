const client = require('../backend');
const logger = require('../utils/logger');
const { audit, buildAuditEntry } = require('../services/auditService');
const {
  ConsentValidationError,
  getConsentStatus,
  getPolicy,
  normalizeDecision,
  recordDecision,
} = require('../services/consentService');

const AUDIT_ACTIONS = Object.freeze({
  accepted: 'CONSENT_ACCEPTED',
  refused: 'CONSENT_REFUSED',
  revoked: 'CONSENT_REVOKED',
});

function sendConsentError(res, error, context) {
  if (error instanceof ConsentValidationError) {
    return res.status(error.status).json({ error: error.message, code: error.code });
  }
  logger.error(context, { details: error.message });
  return res.status(500).json({ error: 'Erro ao processar consentimento' });
}

const getConsentPolicy = (req, res) => res.json(getPolicy());

const getMyConsents = async (req, res) => {
  try {
    const status = await getConsentStatus(client, { userId: req.user.id, role: req.user.role });
    return res.json(status);
  } catch (error) {
    return sendConsentError(res, error, 'Erro ao consultar consentimento');
  }
};

// O titular é sempre o usuário do token: não há ID de usuário no corpo.
const recordMyConsent = async (req, res) => {
  try {
    const decision = normalizeDecision(req.body || {});
    const { ip_address: ipAddress, user_agent: userAgent } = buildAuditEntry(req, {});
    const record = await recordDecision(client, {
      userId: req.user.id,
      ...decision,
      ipAddress,
      userAgent,
    });

    audit(req, {
      action: AUDIT_ACTIONS[decision.decision],
      resource: 'consents',
      resource_id: record.id,
      outcome: 'SUCCESS',
      detail: { purpose: decision.purpose, version: decision.version },
    });

    const status = await getConsentStatus(client, { userId: req.user.id, role: req.user.role });
    return res.status(201).json({ consent: record, status });
  } catch (error) {
    return sendConsentError(res, error, 'Erro ao registrar consentimento');
  }
};

module.exports = {
  getConsentPolicy,
  getMyConsents,
  recordMyConsent,
};
