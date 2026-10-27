const crypto = require('node:crypto');

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function getAiUsageConfig(env = process.env) {
  return Object.freeze({
    cacheTtlMs: positiveInteger(env.AI_CACHE_TTL_MS, 0),
    cacheMaxEntries: positiveInteger(env.AI_CACHE_MAX_ENTRIES, 100),
    dailyQuota: positiveInteger(env.AI_DAILY_QUOTA, 0),
    promptVersion: String(env.AI_PROMPT_VERSION || 'v1').slice(0, 80),
    ragManifestVersion: String(env.RAG_MANIFEST_VERSION || '1.0.0').slice(0, 80),
    cachePatientResponses: env.AI_CACHE_PATIENT_RESPONSES === 'true',
  });
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function buildCacheKey({ user, operation, route, request, config = getAiUsageConfig() }) {
  if (!user || user.id === undefined || user.id === null) return null;
  const fingerprint = stableStringify({
    userId: String(user.id),
    role: user.role || 'unknown',
    operation,
    route,
    model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    promptVersion: config.promptVersion,
    ragManifestVersion: config.ragManifestVersion,
    request,
  });
  return `ai:${crypto.createHash('sha256').update(fingerprint).digest('hex')}`;
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function createAiUsageStore(options = {}) {
  const config = options.config || getAiUsageConfig(options.env || process.env);
  const clock = options.clock || (() => Date.now());
  const cache = new Map();
  const quotas = new Map();
  const metrics = new Map();

  function metric(operation) {
    if (!metrics.has(operation)) {
      metrics.set(operation, {
        requests: 0,
        cacheHits: 0,
        cacheMisses: 0,
        quotaBlocked: 0,
        errors: 0,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        totalDurationMs: 0,
      });
    }
    return metrics.get(operation);
  }

  function recordRequest(operation, durationMs = 0) {
    const item = metric(operation);
    item.requests += 1;
    item.totalDurationMs += Math.max(0, Number(durationMs) || 0);
  }

  function recordCache(operation, hit) {
    const item = metric(operation);
    item[hit ? 'cacheHits' : 'cacheMisses'] += 1;
  }

  function recordQuotaBlocked(operation) {
    metric(operation).quotaBlocked += 1;
  }

  function recordError(operation) {
    metric(operation).errors += 1;
  }

  function recordProviderUsage(operation, usage = {}) {
    const item = metric(operation);
    const inputTokens = positiveInteger(usage.inputTokens ?? usage.promptTokenCount, 0);
    const outputTokens = positiveInteger(usage.outputTokens ?? usage.candidatesTokenCount, 0);
    const totalTokens = positiveInteger(usage.totalTokens, inputTokens + outputTokens);
    item.inputTokens += inputTokens;
    item.outputTokens += outputTokens;
    item.totalTokens += totalTokens;
  }

  function consumeQuota(userId, operation) {
    if (!config.dailyQuota) return { allowed: true, used: 0, limit: null };
    const day = new Date(clock()).toISOString().slice(0, 10);
    const key = `${day}:${String(userId)}`;
    const used = quotas.get(key) || 0;
    if (used >= config.dailyQuota) {
      recordQuotaBlocked(operation);
      return { allowed: false, used, limit: config.dailyQuota };
    }
    quotas.set(key, used + 1);
    return { allowed: true, used: used + 1, limit: config.dailyQuota };
  }

  function getCached(key) {
    if (!key || !config.cacheTtlMs) return undefined;
    const item = cache.get(key);
    if (!item) return undefined;
    if (item.expiresAt <= clock()) {
      cache.delete(key);
      return undefined;
    }
    return clone(item.value);
  }

  function setCached(key, value) {
    if (!key || !config.cacheTtlMs) return false;
    cache.set(key, { value: clone(value), expiresAt: clock() + config.cacheTtlMs });
    while (cache.size > config.cacheMaxEntries) cache.delete(cache.keys().next().value);
    return true;
  }

  function snapshot() {
    return Object.fromEntries([...metrics.entries()].map(([operation, item]) => [operation, { ...item }]));
  }

  return Object.freeze({
    config,
    consumeQuota,
    getCached,
    setCached,
    recordRequest,
    recordCache,
    recordError,
    recordProviderUsage,
    snapshot,
  });
}

let defaultStore;
function getDefaultAiUsageStore() {
  if (!defaultStore) defaultStore = createAiUsageStore();
  return defaultStore;
}

module.exports = {
  buildCacheKey,
  createAiUsageStore,
  getAiUsageConfig,
  getDefaultAiUsageStore,
  stableStringify,
};
