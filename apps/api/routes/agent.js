const express = require('express');
const router = express.Router();

const agentController = require('../controllers/agentController');
const { authenticateToken, requireRole } = require('../middlewares/auth');
const { createAuthLimiters } = require('../middlewares/authRateLimit');
const { clinicalLimiter } = createAuthLimiters();

// Apenas medico/admin; o vinculo medico-paciente e validado no controller.
router.post(
  '/maternal-analysis',
  authenticateToken,
  requireRole('medico', 'admin'),
  clinicalLimiter,
  agentController.handleMaternalAnalysis
);

module.exports = router;
