const express = require('express');
const { rateLimit } = require('express-rate-limit');
const router = express.Router();

const agentController = require('../controllers/agentController');
const { authenticateToken, requireRole } = require('../middlewares/auth');
const { positiveInteger, createAiLimiterOptions } = require('../middlewares/authRateLimit');
const { createAiUsageMiddleware } = require('../middlewares/aiUsage');

// Apenas medico/admin; o vinculo medico-paciente e validado no controller.
router.post(
  '/maternal-analysis',
  rateLimit(createAiLimiterOptions({ fallbackMax: positiveInteger(process.env.CLINICAL_RATE_LIMIT_MAX, 60) })),
  authenticateToken,
  requireRole('medico', 'admin'),
  createAiUsageMiddleware({ operation: 'maternal_analysis' }),
  agentController.handleMaternalAnalysis
);

module.exports = router;
