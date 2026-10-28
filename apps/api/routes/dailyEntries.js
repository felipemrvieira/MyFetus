const express = require('express');
const { rateLimit } = require('express-rate-limit');
const controller = require('../controllers/dailyEntriesController');
const { createClinicalLimiterOptions } = require('../middlewares/authRateLimit');
const { authenticateToken, requireRole } = require('../middlewares/auth');

const router = express.Router();
router.use(rateLimit(createClinicalLimiterOptions()));

router.post(
  '/',
  authenticateToken,
  requireRole('gestante', 'admin'),
  controller.createDailyEntry
);
router.get(
  '/pregnancies/:pregnancyId',
  authenticateToken,
  requireRole('gestante', 'medico', 'admin'),
  controller.listDailyEntries
);
router.get(
  '/pregnancies/:pregnancyId/feed',
  authenticateToken,
  requireRole('gestante', 'medico', 'admin'),
  controller.listDailyRiskFeed
);
router.put(
  '/:entryKey',
  authenticateToken,
  requireRole('gestante', 'admin'),
  controller.updateDailyEntry
);

module.exports = router;
