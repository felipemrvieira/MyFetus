const express = require('express');
const router = express.Router();

const {
  calculatePercentile,
  getGrowthChart
} = require('../controllers/growthPercentileController');
const { authenticateToken } = require('../middlewares/auth');
const { createAuthLimiters } = require('../middlewares/authRateLimit');
const { clinicalLimiter } = createAuthLimiters();

router.use(authenticateToken, clinicalLimiter);

router.post('/percentile', calculatePercentile);

router.get('/chart', getGrowthChart);

module.exports = router;
