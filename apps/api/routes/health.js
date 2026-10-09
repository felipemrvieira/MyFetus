const express = require('express');
const { handleHealthRequest } = require('../services/healthService');

const router = express.Router();

router.get('/', (req, res) => handleHealthRequest(req, res));

module.exports = router;
