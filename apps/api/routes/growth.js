const express = require('express');
const router = express.Router();

const {
  calculatePercentile,
  getGrowthChart
} = require('../controllers/growthPercentileController');
const { authenticateToken } = require('../middlewares/auth');

router.use(authenticateToken);

router.post('/percentile', calculatePercentile);

router.get('/chart', getGrowthChart);

module.exports = router;
