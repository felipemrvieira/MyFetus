const express = require('express');
const router = express.Router();
const { rateLimit } = require('express-rate-limit');
const {
  cancelExamRequest,
  createExamRequest,
  getExamRequests,
} = require('../controllers/examRequestController');
const { authenticateToken, requireRole } = require('../middlewares/auth');

const examRequestLimiter = rateLimit({
  windowMs: Number(process.env.EXAM_REQUEST_RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000),
  limit: Number(process.env.EXAM_REQUEST_RATE_LIMIT_MAX || 100),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
});

router.get(
  '/pregnant/:pregnantId',
  examRequestLimiter,
  authenticateToken,
  requireRole('gestante', 'medico', 'admin'),
  getExamRequests
);
router.post(
  '/',
  examRequestLimiter,
  authenticateToken,
  requireRole('medico'),
  createExamRequest
);
router.delete(
  '/:id',
  examRequestLimiter,
  authenticateToken,
  requireRole('medico'),
  cancelExamRequest
);

module.exports = router;
