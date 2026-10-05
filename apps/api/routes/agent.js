const express = require('express');
const { rateLimit } = require('express-rate-limit');
const router = express.Router();

const agentController = require('../controllers/agentController');
const { authenticateToken, requireRole } = require('../middlewares/auth');
const { positiveInteger } = require('../middlewares/authRateLimit');

// Apenas medico/admin; o vinculo medico-paciente e validado no controller.
router.post(
  '/maternal-analysis',
  authenticateToken,
  requireRole('medico', 'admin'),
  rateLimit({
    windowMs: positiveInteger(process.env.AUTH_RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000),
    limit: positiveInteger(process.env.CLINICAL_RATE_LIMIT_MAX, 60),
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Muitas tentativas. Tente novamente mais tarde.' },
  }),
  agentController.handleMaternalAnalysis
);

module.exports = router;
