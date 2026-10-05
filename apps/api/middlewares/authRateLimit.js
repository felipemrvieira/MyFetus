const { rateLimit } = require('express-rate-limit');
const { audit } = require('../services/auditService');

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function createAuthLimiters(options = {}) {
  const windowMs = positiveInteger(
    options.windowMs ?? process.env.AUTH_RATE_LIMIT_WINDOW_MS,
    15 * 60 * 1000
  );
  const loginMax = positiveInteger(
    options.loginMax ?? process.env.AUTH_RATE_LIMIT_MAX,
    10
  );
  const registerMax = positiveInteger(
    options.registerMax ?? process.env.REGISTER_RATE_LIMIT_MAX,
    5
  );
  const adminReadMax = positiveInteger(
    options.adminReadMax ?? process.env.ADMIN_READ_RATE_LIMIT_MAX,
    100
  );
  const clinicalMax = positiveInteger(
    options.clinicalMax ?? process.env.CLINICAL_RATE_LIMIT_MAX,
    60
  );

  function createLimiter(limit, action, resource) {
    return rateLimit({
      windowMs,
      limit,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      message: {
        error: 'Muitas tentativas. Tente novamente mais tarde.',
      },
      handler(req, res, _next, limiterOptions) {
        audit(req, {
          action,
          resource,
          outcome: 'FAILURE',
          detail: { path: req.originalUrl, method: req.method },
        });
        return res.status(limiterOptions.statusCode).json(limiterOptions.message);
      },
    });
  }

  return {
    loginLimiter: createLimiter(loginMax, 'USER_LOGIN_BLOCKED', 'users'),
    registerLimiter: createLimiter(registerMax, 'USER_REGISTER_BLOCKED', 'users'),
    adminReadLimiter: createLimiter(adminReadMax, 'ADMIN_READ_BLOCKED', 'users'),
    clinicalLimiter: createLimiter(clinicalMax, 'CLINICAL_READ_BLOCKED', 'clinical_data'),
  };
}

module.exports = {
  createAuthLimiters,
  positiveInteger,
};
