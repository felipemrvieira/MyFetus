-- E5-03.1: registro de tokens de notificacao sem obrigar opt-in nem envio real.
CREATE TABLE IF NOT EXISTS device_push_tokens (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash CHAR(64) NOT NULL UNIQUE,
  token_ciphertext TEXT NOT NULL,
  platform TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  encryption_key_version INTEGER,
  CONSTRAINT device_push_tokens_platform_check CHECK (platform IN ('ios', 'android', 'web'))
);

CREATE INDEX IF NOT EXISTS idx_device_push_tokens_user_enabled
  ON device_push_tokens (user_id, enabled, last_seen_at DESC);

DROP TRIGGER IF EXISTS trg_device_push_tokens_updated_at ON device_push_tokens;
CREATE TRIGGER trg_device_push_tokens_updated_at
  BEFORE UPDATE ON device_push_tokens
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
