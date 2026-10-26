/**
 * Direitos do titular (E7-02.1, LGPD art. 18).
 *
 * Endpoints:
 *   - POST /export : exporta em JSON os dados do usuário autenticado, após
 *                    confirmação da senha.
 *
 * Observações:
 *   - Limite próprio e baixo, porque a rota confere senha.
 *   - Fica fora do bloqueio por consentimento (middlewares/consent.js): quem
 *     revogou o consentimento continua podendo exercer seus direitos.
 */
const express = require('express');
const { rateLimit } = require('express-rate-limit');
const router = express.Router();
const { exportMyData } = require('../controllers/privacyController');
const { authenticateToken } = require('../middlewares/auth');
const { createDataExportLimiterOptions } = require('../middlewares/authRateLimit');

const exportLimiter = rateLimit(createDataExportLimiterOptions());

router.post('/export', exportLimiter, authenticateToken, exportMyData);

module.exports = router;
