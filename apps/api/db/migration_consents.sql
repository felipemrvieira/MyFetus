-- E7-01.1: consentimento versionado (LGPD).
--
-- Cada aceite, recusa ou revogação é uma nova linha; o estado atual de um
-- usuário em uma finalidade é o registro mais recente. A tabela é append-only
-- (como audit_logs) para preservar a trilha: revogar não apaga o aceite anterior.
--
-- Sem chave estrangeira para users (mesmo padrão de audit_logs): a prova do
-- consentimento cabe ao controlador (LGPD, art. 8º, §2º) e não deve impedir a
-- exclusão da conta; a retenção destes registros é decisão da E7-02.
CREATE TABLE IF NOT EXISTS consents (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  purpose VARCHAR(50) NOT NULL,
  version VARCHAR(30) NOT NULL,
  decision VARCHAR(10) NOT NULL CHECK (decision IN ('accepted', 'refused', 'revoked')),
  ip_address VARCHAR(45),
  user_agent VARCHAR(500),
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE OR REPLACE RULE consents_no_update AS
  ON UPDATE TO consents DO INSTEAD NOTHING;

CREATE OR REPLACE RULE consents_no_delete AS
  ON DELETE TO consents DO INSTEAD NOTHING;

CREATE INDEX IF NOT EXISTS idx_consents_user_purpose
  ON consents (user_id, purpose, created_at DESC, id DESC);
