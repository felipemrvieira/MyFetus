const express = require('express');
const { rateLimit } = require('express-rate-limit');
const controller = require('../controllers/alertEventController');
const { createClinicalLimiterOptions } = require('../middlewares/authRateLimit');
const { authenticateToken, requireRole } = require('../middlewares/auth');

const router = express.Router();
router.use(rateLimit(createClinicalLimiterOptions()));

router.get(
  '/pregnancies/:pregnancyId',
  authenticateToken,
  requireRole('gestante', 'medico', 'admin'),
  controller.listAlertEvents
);
router.post(
  '/:alertId/acknowledge',
  authenticateToken,
  requireRole('medico', 'admin'),
  controller.acknowledge
);
router.post(
  '/:alertId/close',
  authenticateToken,
  requireRole('medico', 'admin'),
  controller.close
);

module.exports = router;
