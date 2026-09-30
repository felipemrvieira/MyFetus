const express = require('express');
const router = express.Router();
const {
  cancelExamRequest,
  createExamRequest,
  getExamRequests,
} = require('../controllers/examRequestController');
const { authenticateToken, requireRole } = require('../middlewares/auth');

router.get(
  '/',
  authenticateToken,
  requireRole('gestante', 'medico', 'admin'),
  getExamRequests
);
router.post(
  '/',
  authenticateToken,
  requireRole('medico'),
  createExamRequest
);
router.delete(
  '/:id',
  authenticateToken,
  requireRole('medico'),
  cancelExamRequest
);

module.exports = router;
