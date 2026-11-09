const crypto = require('node:crypto');

class PushTokenValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PushTokenValidationError';
    this.validationMessage = message;
  }
}

const PLATFORMS = Object.freeze(['ios', 'android', 'web']);

function normalizeToken(value) {
  if (typeof value !== 'string') throw new PushTokenValidationError('token deve ser texto');
  const token = value.trim();
  if (token.length < 10 || token.length > 4096) {
    throw new PushTokenValidationError('token deve ter entre 10 e 4096 caracteres');
  }
  return token;
}

function normalizePlatform(value) {
  const platform = String(value || '').trim().toLowerCase();
  if (!PLATFORMS.includes(platform)) {
    throw new PushTokenValidationError('platform deve ser ios, android ou web');
  }
  return platform;
}

function tokenHash(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

async function registerToken(db, { userId, tokenHashValue, tokenCiphertext, platform, encryptionKeyVersion }) {
  const id = Number(userId);
  if (!Number.isInteger(id) || id <= 0) throw new PushTokenValidationError('user_id invalido');
  if (typeof tokenHashValue !== 'string' || !/^[a-f0-9]{64}$/.test(tokenHashValue)) {
    throw new PushTokenValidationError('token_hash invalido');
  }
  if (typeof tokenCiphertext !== 'string' || !tokenCiphertext) {
    throw new PushTokenValidationError('token cifrado invalido');
  }
  const normalizedPlatform = normalizePlatform(platform);
  const result = await db.query(
    `INSERT INTO device_push_tokens
       (user_id, token_hash, token_ciphertext, platform, enabled, revoked_at, last_seen_at, encryption_key_version)
     VALUES ($1, $2, $3, $4, TRUE, NULL, CURRENT_TIMESTAMP, $5)
     ON CONFLICT (token_hash) DO UPDATE SET
       user_id = EXCLUDED.user_id,
       token_ciphertext = EXCLUDED.token_ciphertext,
       platform = EXCLUDED.platform,
       enabled = TRUE,
       revoked_at = NULL,
       last_seen_at = CURRENT_TIMESTAMP,
       encryption_key_version = EXCLUDED.encryption_key_version
     RETURNING id, user_id, platform, enabled, last_seen_at, revoked_at, created_at, updated_at`,
    [id, tokenHashValue, tokenCiphertext, normalizedPlatform, encryptionKeyVersion]
  );
  return result.rows[0];
}

async function revokeToken(db, { userId, tokenHashValue }) {
  const id = Number(userId);
  const result = await db.query(
    `UPDATE device_push_tokens
     SET enabled = FALSE, revoked_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
     WHERE user_id = $1 AND token_hash = $2
     RETURNING id, user_id, platform, enabled, last_seen_at, revoked_at, created_at, updated_at`,
    [id, tokenHashValue]
  );
  return result.rows[0] || null;
}

module.exports = {
  PLATFORMS,
  PushTokenValidationError,
  normalizePlatform,
  normalizeToken,
  registerToken,
  revokeToken,
  tokenHash,
};
