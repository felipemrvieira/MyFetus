const test = require('node:test');
const assert = require('node:assert/strict');
const {
  PushTokenValidationError,
  normalizePlatform,
  normalizeToken,
  registerToken,
  revokeToken,
  tokenHash,
} = require('../services/pushTokenService');

test('normaliza tokens, plataforma e hash sem expor o token', async () => {
  const token = normalizeToken(' ExpoPushToken[synthetic-token-123] ');
  assert.equal(normalizePlatform('ANDROID'), 'android');
  assert.match(tokenHash(token), /^[a-f0-9]{64}$/);
  assert.throws(() => normalizePlatform('desktop'), PushTokenValidationError);
});

test('registra de forma idempotente e reativa token revogado', async () => {
  const calls = [];
  const db = { query: async (text, values) => { calls.push({ text, values }); return { rows: [{ id: 3, enabled: true }] }; } };
  const result = await registerToken(db, {
    userId: 8,
    tokenHashValue: tokenHash('ExpoPushToken[synthetic-token-123]'),
    tokenCiphertext: 'ciphertext',
    platform: 'ios',
    encryptionKeyVersion: 1,
  });
  assert.equal(result.enabled, true);
  assert.match(calls[0].text, /ON CONFLICT \(token_hash\)/);
  const revoked = await revokeToken(db, { userId: 8, tokenHashValue: tokenHash('ExpoPushToken[synthetic-token-123]') });
  assert.equal(revoked.id, 3);
});
