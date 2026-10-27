const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildCacheKey,
  createAiUsageStore,
  getAiUsageConfig,
} = require('../services/aiUsageService');

test('configuração mantém cache e cota desligados até decisão do PO', () => {
  assert.deepEqual(getAiUsageConfig({}), {
    cacheTtlMs: 0,
    cacheMaxEntries: 100,
    dailyQuota: 0,
    promptVersion: 'v1',
    ragManifestVersion: '1.0.0',
    cachePatientResponses: false,
  });
});

test('chave de cache é por usuário, contexto, versão e conteúdo sem guardar a pergunta', () => {
  const config = getAiUsageConfig({ AI_PROMPT_VERSION: 'v2' });
  const first = buildCacheKey({ user: { id: 1, role: 'gestante' }, operation: 'chat', route: '/chat', request: { query: 'pressão' }, config });
  const same = buildCacheKey({ user: { id: 1, role: 'gestante' }, operation: 'chat', route: '/chat', request: { query: 'pressão' }, config });
  const otherUser = buildCacheKey({ user: { id: 2, role: 'gestante' }, operation: 'chat', route: '/chat', request: { query: 'pressão' }, config });
  assert.equal(first, same);
  assert.notEqual(first, otherUser);
  assert.match(first, /^ai:[a-f0-9]{64}$/);
  assert.equal(first.includes('pressão'), false);
});

test('cota diária, expiração e limite de entradas são determinísticos', () => {
  let now = Date.parse('2026-10-27T12:00:00Z');
  const store = createAiUsageStore({
    config: getAiUsageConfig({ AI_DAILY_QUOTA: '2', AI_CACHE_TTL_MS: '1000', AI_CACHE_MAX_ENTRIES: '1' }),
    clock: () => now,
  });
  assert.equal(store.consumeQuota(7, 'chat').allowed, true);
  assert.equal(store.consumeQuota(7, 'chat').allowed, true);
  assert.equal(store.consumeQuota(7, 'chat').allowed, false);
  store.setCached('a', { answer: 'A' });
  assert.deepEqual(store.getCached('a'), { answer: 'A' });
  now += 1001;
  assert.equal(store.getCached('a'), undefined);
});

test('métricas não carregam prompt nem resposta', () => {
  const store = createAiUsageStore({ config: getAiUsageConfig({}) });
  store.recordRequest('chat', 12);
  store.recordProviderUsage('chat', { promptTokenCount: 4, candidatesTokenCount: 6 });
  const metrics = store.snapshot();
  assert.deepEqual(metrics.chat, {
    requests: 1,
    cacheHits: 0,
    cacheMisses: 0,
    quotaBlocked: 0,
    errors: 0,
    inputTokens: 4,
    outputTokens: 6,
    totalTokens: 10,
    totalDurationMs: 12,
  });
  assert.equal(JSON.stringify(metrics).includes('prompt'), false);
});
