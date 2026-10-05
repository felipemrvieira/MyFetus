const express = require('express');
const { rateLimit } = require('express-rate-limit');
const router = express.Router();

const {
  calculatePercentile,
  getGrowthChart
} = require('../controllers/growthPercentileController');
const { authenticateToken } = require('../middlewares/auth');
const { positiveInteger } = require('../middlewares/authRateLimit');

router.use(authenticateToken);

router.post(
  '/percentile',
  rateLimit({
    windowMs: positiveInteger(process.env.AUTH_RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000),
    limit: positiveInteger(process.env.CLINICAL_RATE_LIMIT_MAX, 60),
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Muitas tentativas. Tente novamente mais tarde.' },
  }),
  calculatePercentile
);

router.get(
  '/chart',
  rateLimit({
    windowMs: positiveInteger(process.env.AUTH_RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000),
    limit: positiveInteger(process.env.CLINICAL_RATE_LIMIT_MAX, 60),
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Muitas tentativas. Tente novamente mais tarde.' },
  }),
  getGrowthChart
);

module.exports = router;
