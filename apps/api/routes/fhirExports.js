const express = require('express');
const { rateLimit } = require('express-rate-limit');
const controller = require('../controllers/fhirExportController');
const { createClinicalLimiterOptions } = require('../middlewares/authRateLimit');
const { authenticateToken, requireRole } = require('../middlewares/auth');

const router = express.Router();
router.use(rateLimit(createClinicalLimiterOptions()));
router.get(
  '/pregnancies/:pregnancyId/fhir',
  authenticateToken,
  requireRole('gestante', 'medico', 'admin'),
  controller.getFhirExportBundle
);

module.exports = router;
