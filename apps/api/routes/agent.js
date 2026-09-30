const express = require('express');
const router = express.Router();

const agentController = require('../controllers/agentController');
const { authenticateToken, requireRole } = require('../middlewares/auth');

// Apenas medico/admin; o vinculo medico-paciente e validado no controller.
router.post(
  '/maternal-analysis',
  authenticateToken,
  requireRole('medico', 'admin'),
  agentController.handleMaternalAnalysis
);

module.exports = router;
