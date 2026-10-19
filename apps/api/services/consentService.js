/**
 * Consentimento versionado (E7-01.1).
 *
 * A tabela `consents` é append-only: o estado de uma finalidade é sempre o
 * registro mais recente do usuário. Funções recebem o cliente do banco para
 * permitir uso dentro de transações (ex.: cadastro).
 */
const {
  CONSENT_DECISIONS,
  CONSENT_PURPOSES,
  CONSENT_REQUIRED_ROLES,
  getPurpose,
  getRequiredPurposes,
} = require('../config/consentPolicy');

class ConsentValidationError extends Error {
  constructor(message, { status = 400, code = 'CONSENT_INVALID' } = {}) {
    super(message);
    this.name = 'ConsentValidationError';
    this.status = status;
    this.code = code;
  }
}

function getPolicy() {
  return {
    purposes: Object.entries(CONSENT_PURPOSES).map(([purpose, config]) => ({
      purpose,
      title: config.title,
      version: config.version,
      required: config.required,
      text: config.text,
    })),
  };
}

/**
 * Valida o aceite enviado no cadastro: todas as finalidades obrigatórias, na
 * versão vigente. Retorna a lista normalizada para gravar.
 */
function validateSignupConsents(consents) {
  const required = getRequiredPurposes();
  const sent = Array.isArray(consents) ? consents : [];

  const missing = required.filter(
    ({ purpose }) => !sent.some((item) => item && item.purpose === purpose)
  );
  if (missing.length > 0) {
    throw new ConsentValidationError(
      'Aceite do termo de uso e da política de privacidade é obrigatório',
      { code: 'CONSENT_REQUIRED' }
    );
  }

  const outdated = required.filter(({ purpose, version }) => {
    const item = sent.find((candidate) => candidate && candidate.purpose === purpose);
    return item.version !== version;
  });
  if (outdated.length > 0) {
    throw new ConsentValidationError(
      'Versão do termo desatualizada; recarregue o termo vigente',
      { status: 409, code: 'CONSENT_VERSION_OUTDATED' }
    );
  }

  return required;
}

function normalizeDecision({ purpose, decision, version }) {
  const config = getPurpose(purpose);
  if (!config) {
    throw new ConsentValidationError('Finalidade de consentimento desconhecida');
  }
  if (!CONSENT_DECISIONS.includes(decision)) {
    throw new ConsentValidationError('decision deve ser accepted, refused ou revoked');
  }
  // Revogação vale para a finalidade; aceite/recusa precisam citar a versão vigente.
  if (decision !== 'revoked' && version !== config.version) {
    throw new ConsentValidationError(
      'Versão do termo desatualizada; recarregue o termo vigente',
      { status: 409, code: 'CONSENT_VERSION_OUTDATED' }
    );
  }
  return { purpose, decision, version: config.version };
}

async function recordDecision(db, { userId, purpose, decision, version, ipAddress, userAgent }) {
  const result = await db.query(
    `INSERT INTO consents (user_id, purpose, version, decision, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, purpose, version, decision, created_at`,
    [userId, purpose, version, decision, ipAddress || null, userAgent || null]
  );
  return result.rows[0];
}

async function getLatestDecisions(db, userId) {
  const result = await db.query(
    `SELECT DISTINCT ON (purpose) purpose, version, decision, created_at
       FROM consents
      WHERE user_id = $1
      ORDER BY purpose, created_at DESC, id DESC`,
    [userId]
  );
  return result.rows;
}

function describeStatus(config, latest) {
  if (!latest) return 'pending';
  if (latest.decision !== 'accepted') return latest.decision;
  return latest.version === config.version ? 'accepted' : 'outdated';
}

/**
 * Status de consentimento do usuário. `required` indica se o papel exige
 * aceite vigente e ainda há finalidade obrigatória pendente.
 */
async function getConsentStatus(db, { userId, role }) {
  const latestByPurpose = new Map(
    (await getLatestDecisions(db, userId)).map((row) => [row.purpose, row])
  );

  const purposes = Object.entries(CONSENT_PURPOSES).map(([purpose, config]) => {
    const latest = latestByPurpose.get(purpose) || null;
    return {
      purpose,
      current_version: config.version,
      required: config.required,
      status: describeStatus(config, latest),
      decided_version: latest ? latest.version : null,
      decided_at: latest ? latest.created_at : null,
    };
  });

  const pending = purposes
    .filter((item) => item.required && item.status !== 'accepted')
    .map(({ purpose, current_version: version }) => ({ purpose, version }));

  return {
    required: CONSENT_REQUIRED_ROLES.includes(role) && pending.length > 0,
    pending,
    purposes,
  };
}

module.exports = {
  ConsentValidationError,
  getConsentStatus,
  getPolicy,
  normalizeDecision,
  recordDecision,
  validateSignupConsents,
};
