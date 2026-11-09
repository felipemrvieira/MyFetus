const express = require('express');
const { rateLimit } = require('express-rate-limit');
const controller = require('../controllers/pushTokenController');
const { authenticateToken } = require('../middlewares/auth');
const { createClinicalLimiterOptions } = require('../middlewares/authRateLimit');

const router = express.Router();
router.use(rateLimit(createClinicalLimiterOptions()));
router.post('/devices', authenticateToken, controller.register);
router.delete('/devices', authenticateToken, controller.revoke);

module.exports = router;
