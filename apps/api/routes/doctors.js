/**
 * Rotas relacionadas ao cadastro de médicos.
 *
 * Definição:
 *   Cria uma conta de médico (role 'medico' em `users` + registro em
 *   `doctors` com CRM/especialidade/telefone). Cadastro público, igual ao
 *   de paciente — por enquanto sem aprovação de admin.
 *
 * Endpoints:
 *   - POST /  : Cria uma conta de médico.
 *   - GET  /  : Lista médicos para decisão do admin.
 *   - GET  /me/approval : Consulta o próprio estado de aprovação.
 *   - GET  /me/dashboard : Pacientes vinculadas ordenadas por gravidade (E3-10).
 *   - PUT  /me : Reenvia dados corrigidos após rejeição/revogação.
 *   - POST /:id/approval : Decide aprovação, rejeição ou revogação.
 */
const express = require('express');
const router = express.Router();
const doctorController = require('../controllers/doctorController');
const doctorDashboardController = require('../controllers/doctorDashboardController');
const { createAuthLimiters } = require('../middlewares/authRateLimit');
const { registerLimiter } = createAuthLimiters();
const { createAdminReadLimiterOptions, createClinicalLimiterOptions } = require('../middlewares/authRateLimit');
const { authenticateToken, requireRole, requireRoleWithoutDoctorApproval } = require('../middlewares/auth');
const { rateLimit } = require('express-rate-limit');

const adminReadLimiter = rateLimit(createAdminReadLimiterOptions());
const clinicalLimiter = rateLimit(createClinicalLimiterOptions());

router.post('/', registerLimiter, doctorController.createDoctor);
router.get(
  '/',
  adminReadLimiter,
  authenticateToken,
  requireRole('admin'),
  doctorController.listDoctors
);
router.get(
  '/me/approval',
  adminReadLimiter,
  authenticateToken,
  requireRoleWithoutDoctorApproval('medico'),
  doctorController.getMyApproval
);
// Só médico: o acesso do admin depende do procedimento auditado da #69.
router.get(
  '/me/dashboard',
  clinicalLimiter,
  authenticateToken,
  requireRole('medico'),
  doctorDashboardController.getMyDashboard
);
router.put(
  '/me',
  adminReadLimiter,
  authenticateToken,
  requireRoleWithoutDoctorApproval('medico'),
  doctorController.resubmitDoctorApproval
);
router.post(
  '/:id/approval',
  adminReadLimiter,
  authenticateToken,
  requireRole('admin'),
  doctorController.decideDoctorApproval
);

module.exports = router;
