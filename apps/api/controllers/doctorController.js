const bcrypt = require('bcrypt');
const client = require('../backend');
const cryptoService = require('../services/cryptoService');
const { hashEmail, normalizeEmail } = require('../services/emailLookupService');
const logger = require('../utils/logger');
const { audit, buildAuditEntry } = require('../services/auditService');
const {
  ConsentValidationError,
  recordDecision,
  validateSignupConsents,
} = require('../services/consentService');

const SALT_ROUNDS = 10;
const DOCTOR_ROLE = 'medico';

function sanitizeUser(user) {
  if (!user) return null;
  const { password, email_lookup_hash, encryption_key_version, ...safeUser } = user;
  return safeUser;
}

function sanitizeDoctor(doctor) {
  if (!doctor) return null;
  const { encryption_key_version, ...safeDoctor } = doctor;
  return safeDoctor;
}

/**
 * Cria uma conta de médico (role 'medico') e o registro correspondente em
 * `doctors`. Cadastro público — qualquer pessoa pode chamar, sem login.
 */
const createDoctor = async (req, res) => {
  const { name, email, password, birthdate, crm, crm_estado, especialidade, telefone, consents } = req.body || {};

  if (
    typeof name !== 'string' || !name.trim() ||
    typeof email !== 'string' || !email.trim() ||
    typeof password !== 'string' || password.length < 8 ||
    typeof birthdate !== 'string' || !birthdate ||
    typeof crm !== 'string' || !crm.trim() ||
    typeof crm_estado !== 'string' || crm_estado.trim().length !== 2
  ) {
    return res.status(400).json({
      error: 'Nome, email, senha (8+ caracteres), data de nascimento, CRM e UF do CRM (2 letras) são obrigatórios',
    });
  }

  // E7-01.1: médico aceita os termos do próprio perfil e declara ciência da política.
  let acceptedConsents;
  try {
    acceptedConsents = validateSignupConsents(consents, DOCTOR_ROLE);
  } catch (error) {
    if (!(error instanceof ConsentValidationError)) throw error;
    const { status, code, message } = error;
    return res.status(status).json({ error: message, code });
  }

  let dbClient;
  try {
    const normalizedEmail = normalizeEmail(email);
    const encryptedUser = cryptoService.encryptRecord(
      { name: name.trim(), email: normalizedEmail, birthdate },
      'users'
    );
    const encryptedDoctor = cryptoService.encryptRecord(
      {
        crm: crm.trim(),
        crm_estado: crm_estado.trim().toUpperCase(),
        telefone: telefone ? String(telefone).trim() : null,
      },
      'doctors'
    );
    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

    dbClient = await client.connect();
    await dbClient.query('BEGIN');

    const userResult = await dbClient.query(
      `INSERT INTO users (
         name, email, password, birthdate, is_active, role,
         email_lookup_hash, encryption_key_version
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        encryptedUser.name,
        encryptedUser.email,
        hashedPassword,
        encryptedUser.birthdate,
        true,
        DOCTOR_ROLE,
        hashEmail(normalizedEmail),
        cryptoService.getCurrentVersion(),
      ]
    );
    const user = userResult.rows[0];

    const doctorResult = await dbClient.query(
      `INSERT INTO doctors (user_id, crm, crm_estado, especialidade, telefone, encryption_key_version)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        user.id,
        encryptedDoctor.crm,
        encryptedDoctor.crm_estado,
        especialidade ? String(especialidade).trim() : null,
        encryptedDoctor.telefone,
        cryptoService.getCurrentVersion(),
      ]
    );

    const { ip_address: ipAddress, user_agent: userAgent } = buildAuditEntry(req, {});
    for (const { purpose, version } of acceptedConsents) {
      await recordDecision(dbClient, {
        userId: user.id,
        purpose,
        version,
        decision: 'accepted',
        ipAddress,
        userAgent,
      });
    }

    await dbClient.query('COMMIT');

    audit(req, {
      action: 'CONSENT_ACCEPTED',
      resource: 'consents',
      resource_id: user.id,
      actor_id: user.id,
      actor_role: DOCTOR_ROLE,
      outcome: 'SUCCESS',
      detail: { consents: acceptedConsents },
    });

    return res.status(201).json({
      user: sanitizeUser(cryptoService.decryptRecord(user, 'users')),
      doctor: sanitizeDoctor(cryptoService.decryptRecord(doctorResult.rows[0], 'doctors')),
    });
  } catch (error) {
    if (dbClient) {
      try {
        await dbClient.query('ROLLBACK');
      } catch (_) {
        // Ignore rollback errors.
      }
    }
    logger.error('Erro ao criar médico', { details: error.message, email });
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Email já cadastrado' });
    }
    return res.status(500).json({ error: 'Erro ao criar médico' });
  } finally {
    if (dbClient) dbClient.release();
  }
};

module.exports = {
  createDoctor,
};
