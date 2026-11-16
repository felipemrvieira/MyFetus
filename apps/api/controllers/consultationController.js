const db = require('../backend');
const { audit } = require('../services/auditService');
const consultationService = require('../services/consultationService');
const {
  doctorCanAccessPregnant,
  findPregnancyById,
} = require('../utils/clinicalAccess');
const logger = require('../utils/logger');

function clientValidationMessage(error) {
  return error instanceof consultationService.ConsultationValidationError
    ? error.message
    : 'Requisicao invalida';
}

function adminAccessReason(req) {
  const candidate = req.get?.('x-admin-access-reason')
    || req.body?.admin_reason
    || req.query?.admin_reason;
  if (typeof candidate !== 'string') return null;
  const reason = candidate.trim();
  return reason.length >= 3 && reason.length <= 500 ? reason : null;
}

async function authorizePregnancy(req, res, pregnancyIdValue) {
  let pregnancyId;
  try {
    pregnancyId = consultationService.validateId(pregnancyIdValue, 'pregnancy_id');
  } catch (error) {
    res.status(400).json({ error: clientValidationMessage(error) });
    return null;
  }

  const pregnancy = await findPregnancyById(pregnancyId);
  if (!pregnancy) {
    if (req.user?.role === 'medico') {
      res.status(403).json({ error: 'Médico não vinculado a esta gestante' });
    } else {
      res.status(404).json({ error: 'Gestação não encontrada' });
    }
    return null;
  }

  if (req.user?.role === 'admin') {
    const reason = adminAccessReason(req);
    if (!reason) {
      res.status(400).json({
        error: 'admin_reason e obrigatorio para acesso administrativo auditado',
      });
      return null;
    }
    return { pregnancy, adminReason: reason };
  }

  if (req.user?.role === 'medico') {
    const allowed = await doctorCanAccessPregnant(req.user.id, pregnancy.pregnant_id);
    if (!allowed) {
      res.status(403).json({ error: 'Médico não vinculado a esta gestante' });
      return null;
    }
    return { pregnancy, adminReason: null };
  }

  res.status(403).json({ error: 'Perfil de usuário não autorizado' });
  return null;
}

function auditDetail(auth, extra = {}) {
  return {
    ...extra,
    ...(auth.adminReason ? { admin_reason: auth.adminReason } : {}),
  };
}

function handleError(res, error) {
  if (error instanceof consultationService.ConsultationValidationError) {
    return res.status(400).json({ error: clientValidationMessage(error) });
  }
  if (error instanceof consultationService.ConsultationNotFoundError) {
    return res.status(404).json({ error: 'Consulta nao encontrada' });
  }
  if (error instanceof consultationService.ConsultationConflictError) {
    return res.status(409).json({ error: 'Consulta ja finalizada; use um adendo para corrigir' });
  }
  logger.error('Erro na API de consultas', { details: error.message });
  return res.status(500).json({ error: 'Erro interno ao acessar consultas' });
}

async function createConsultation(req, res) {
  try {
    const auth = await authorizePregnancy(req, res, req.params.pregnancyId);
    if (!auth) return;
    const record = await consultationService.createConsultation(
      db,
      auth.pregnancy.id,
      req.body,
      req.user.id
    );
    audit(req, {
      action: 'CONSULTATION_CREATED',
      resource: 'consultations',
      resource_id: record.id,
      outcome: 'SUCCESS',
      detail: auditDetail(auth, { pregnancy_id: auth.pregnancy.id }),
    });
    return res.status(201).json(record);
  } catch (error) {
    return handleError(res, error);
  }
}

async function listConsultations(req, res) {
  try {
    const auth = await authorizePregnancy(req, res, req.params.pregnancyId);
    if (!auth) return;
    const records = await consultationService.listConsultations(
      db,
      auth.pregnancy.id,
      req.query
    );
    audit(req, {
      action: 'CONSULTATION_LISTED',
      resource: 'consultations',
      resource_id: auth.pregnancy.id,
      outcome: 'SUCCESS',
      detail: auditDetail(auth, { pregnancy_id: auth.pregnancy.id }),
    });
    return res.json(records);
  } catch (error) {
    return handleError(res, error);
  }
}

async function findAuthorizedConsultation(req, res) {
  const consultation = await consultationService.findConsultation(db, req.params.id);
  if (!consultation) {
    res.status(404).json({ error: 'Consulta nao encontrada' });
    return null;
  }
  const auth = await authorizePregnancy(req, res, consultation.pregnancy_id);
  if (!auth) return null;
  return { consultation, auth };
}

async function getConsultation(req, res) {
  try {
    const authorized = await findAuthorizedConsultation(req, res);
    if (!authorized) return;
    const record = consultationService.presentConsultation(authorized.consultation);
    audit(req, {
      action: 'CONSULTATION_READ',
      resource: 'consultations',
      resource_id: record.id,
      outcome: 'SUCCESS',
      detail: auditDetail(authorized.auth, { pregnancy_id: record.pregnancy_id }),
    });
    return res.json(record);
  } catch (error) {
    return handleError(res, error);
  }
}

async function createAddendum(req, res) {
  try {
    const authorized = await findAuthorizedConsultation(req, res);
    if (!authorized) return;
    const record = await consultationService.createAddendum(
      db,
      authorized.consultation.id,
      req.body,
      req.user.id
    );
    audit(req, {
      action: 'CONSULTATION_ADDENDUM_CREATED',
      resource: 'consultations',
      resource_id: record.id,
      outcome: 'SUCCESS',
      detail: auditDetail(authorized.auth, {
        pregnancy_id: record.pregnancy_id,
        parent_consultation_id: authorized.consultation.id,
      }),
    });
    return res.status(201).json(record);
  } catch (error) {
    return handleError(res, error);
  }
}

async function finalizeConsultation(req, res) {
  try {
    const authorized = await findAuthorizedConsultation(req, res);
    if (!authorized) return;
    const record = await consultationService.finalizeConsultation(db, authorized.consultation.id);
    audit(req, {
      action: 'CONSULTATION_FINALIZED',
      resource: 'consultations',
      resource_id: record.id,
      outcome: 'SUCCESS',
      detail: auditDetail(authorized.auth, { pregnancy_id: record.pregnancy_id }),
    });
    return res.json(record);
  } catch (error) {
    return handleError(res, error);
  }
}

module.exports = {
  createAddendum,
  createConsultation,
  finalizeConsultation,
  getConsultation,
  listConsultations,
};
