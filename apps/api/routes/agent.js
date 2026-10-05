const express = require('express');
const { rateLimit } = require('express-rate-limit');
const router = express.Router();

const agentController = require('../controllers/agentController');
const { authenticateToken, requireRole } = require('../middlewares/auth');
const { createClinicalLimiterOptions } = require('../middlewares/authRateLimit');
const clinicalLimiter = rateLimit(createClinicalLimiterOptions());

// Apenas medico/admin; o vinculo medico-paciente e validado no controller.
router.post(
  '/maternal-analysis',
  authenticateToken,
  requireRole('medico', 'admin'),
  clinicalLimiter,
  agentController.handleMaternalAnalysis
);

module.exports = router;
