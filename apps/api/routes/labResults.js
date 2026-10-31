const express = require('express');
const { rateLimit } = require('express-rate-limit');
const controller = require('../controllers/labResultsController');
const { createClinicalLimiterOptions } = require('../middlewares/authRateLimit');
const { authenticateToken, requireRole } = require('../middlewares/auth');

// Revisão médica dos analitos (E2-04): só o médico vinculado, sem admin.
const router = express.Router();
router.use(rateLimit(createClinicalLimiterOptions()));
const requireDoctor = [authenticateToken, requireRole('medico')];

router.get('/documents/:documentId', requireDoctor, controller.getDocumentLabResults);
router.get('/:id/history', requireDoctor, controller.getLabResultHistory);
router.post('/:id/accept', requireDoctor, controller.acceptLabResult);
router.post('/:id/correct', requireDoctor, controller.correctLabResult);
router.post('/:id/reject', requireDoctor, controller.rejectLabResult);
router.post('/:id/reopen', requireDoctor, controller.reopenLabResult);

module.exports = router;
