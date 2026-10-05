const express = require('express');
const { rateLimit } = require('express-rate-limit');
const router = express.Router();

const {
  calculatePercentile,
  getGrowthChart
} = require('../controllers/growthPercentileController');
const { authenticateToken } = require('../middlewares/auth');
const { createClinicalLimiterOptions } = require('../middlewares/authRateLimit');
const clinicalLimiter = rateLimit(createClinicalLimiterOptions());

router.use(authenticateToken, clinicalLimiter);

router.post('/percentile', calculatePercentile);

router.get('/chart', getGrowthChart);

module.exports = router;
