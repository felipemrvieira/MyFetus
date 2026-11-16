const db = require('../backend');
const cryptoService = require('../services/cryptoService');
const pushTokenService = require('../services/pushTokenService');
const { sendInternalError } = require('../utils/httpErrors');

function hashFromBody(value) {
  return pushTokenService.tokenHash(pushTokenService.normalizeToken(value));
}

function handleError(res, error) {
  if (error instanceof pushTokenService.PushTokenValidationError) {
    return res.status(400).json({ error: error.validationMessage });
  }
  return sendInternalError(res);
}

async function register(req, res) {
  try {
    const token = pushTokenService.normalizeToken(req.body?.token);
    const result = await pushTokenService.registerToken(db, {
      userId: req.user.id,
      tokenHashValue: hashFromBody(token),
      tokenCiphertext: cryptoService.encryptRecord({ token }, 'device_push_tokens').token,
      platform: req.body?.platform,
      encryptionKeyVersion: cryptoService.getCurrentVersion(),
    });
    return res.status(201).json(result);
  } catch (error) {
    return handleError(res, error);
  }
}

async function revoke(req, res) {
  try {
    const tokenHashValue = hashFromBody(req.body?.token);
    const result = await pushTokenService.revokeToken(db, {
      userId: req.user.id,
      tokenHashValue,
    });
    return result ? res.json(result) : res.status(404).json({ error: 'Token nao encontrado' });
  } catch (error) {
    return handleError(res, error);
  }
}

module.exports = { register, revoke };
