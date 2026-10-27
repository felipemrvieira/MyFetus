const {
  buildCacheKey,
  getDefaultAiUsageStore,
} = require('../services/aiUsageService');

function createAiUsageMiddleware(options = {}) {
  const operation = options.operation || 'ai';
  const store = options.store || getDefaultAiUsageStore();
  const allowPatientCache = options.allowPatientCache === true;

  return (req, res, next) => {
    const user = req.user || {};
    const patientRequest = Boolean(req.body?.patient_id || req.body?.patientId);
    const cacheEnabled = store.config.cacheTtlMs > 0
      && (!patientRequest || (allowPatientCache && store.config.cachePatientResponses));
    const key = cacheEnabled
      ? buildCacheKey({
        user,
        operation,
        route: req.originalUrl,
        request: req.body || {},
        config: store.config,
      })
      : null;

    const quota = store.consumeQuota(user.id, operation);
    if (!quota.allowed) {
      return res.status(429).json({
        error: 'Cota diária de IA atingida. Tente novamente amanhã.',
        code: 'AI_DAILY_QUOTA_EXCEEDED',
      });
    }

    if (key) {
      const cached = store.getCached(key);
      if (cached !== undefined) {
        store.recordCache(operation, true);
        res.set('X-AI-Cache', 'HIT');
        return res.status(200).json(cached);
      }
      store.recordCache(operation, false);
    }

    const startedAt = Date.now();
    store.recordRequest(operation);
    const originalJson = res.json.bind(res);
    res.json = (body) => {
      const durationMs = Date.now() - startedAt;
      if (res.statusCode >= 200 && res.statusCode < 400 && key) store.setCached(key, body);
      store.recordRequest(`${operation}.latency`, durationMs);
      return originalJson(body);
    };
    res.once('finish', () => {
      if (res.statusCode >= 500) store.recordError(operation);
    });
    res.set('X-AI-Cache', key ? 'MISS' : 'DISABLED');
    return next();
  };
}

module.exports = { createAiUsageMiddleware };
