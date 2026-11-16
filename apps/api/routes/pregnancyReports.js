const express = require('express');
const { rateLimit } = require('express-rate-limit');
const controller = require('../controllers/pregnancyReportController');
const { createClinicalLimiterOptions } = require('../middlewares/authRateLimit');
const { authenticateToken, requireRole } = require('../middlewares/auth');

const router = express.Router();
router.use(rateLimit(createClinicalLimiterOptions()));

router.get(
  '/pregnancies/:pregnancyId/snapshot',
  authenticateToken,
  requireRole('gestante'),
  controller.getPregnancyReportSnapshot
);

module.exports = router;
