const express = require('express');
const { rateLimit } = require('express-rate-limit');
const controller = require('../controllers/clinicalRiskController');
const { createClinicalLimiterOptions } = require('../middlewares/authRateLimit');
const { authenticateToken, requireRole } = require('../middlewares/auth');

const router = express.Router();
router.use(rateLimit(createClinicalLimiterOptions()));
router.post(
  '/pregnancies/:pregnancyId/evaluations/exams',
  authenticateToken,
  requireRole('medico', 'admin'),
  controller.syncExamObservations
);

module.exports = router;
