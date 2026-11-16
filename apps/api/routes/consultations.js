const express = require('express');
const { rateLimit } = require('express-rate-limit');
const controller = require('../controllers/consultationController');
const { authenticateToken, requireRole } = require('../middlewares/auth');
const { createClinicalLimiterOptions } = require('../middlewares/authRateLimit');

const router = express.Router();
router.use(rateLimit(createClinicalLimiterOptions()));

const consultationAccess = [
  authenticateToken,
  requireRole('medico', 'admin'),
];

router.get(
  '/pregnancies/:pregnancyId',
  ...consultationAccess,
  controller.listConsultations
);
router.post(
  '/pregnancies/:pregnancyId',
  ...consultationAccess,
  controller.createConsultation
);
router.get(
  '/:id',
  ...consultationAccess,
  controller.getConsultation
);
router.post(
  '/:id/addenda',
  ...consultationAccess,
  controller.createAddendum
);
router.post(
  '/:id/finalize',
  ...consultationAccess,
  controller.finalizeConsultation
);

module.exports = router;
