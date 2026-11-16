const express = require('express');
const { rateLimit } = require('express-rate-limit');
const controller = require('../controllers/documentReportController');
const { createClinicalLimiterOptions } = require('../middlewares/authRateLimit');
const { authenticateToken, requireRole } = require('../middlewares/auth');

const router = express.Router();
router.use(rateLimit(createClinicalLimiterOptions()));

router.get(
  '/documents/:documentId',
  authenticateToken,
  requireRole('gestante', 'medico'),
  controller.getDocumentReports
);
router.post(
  '/documents/:documentId',
  authenticateToken,
  requireRole('medico'),
  controller.createDocumentReport
);
router.post(
  '/:reportId/publish',
  authenticateToken,
  requireRole('medico'),
  controller.publishDocumentReport
);

module.exports = router;
