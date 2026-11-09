CREATE TABLE IF NOT EXISTS alert_event_history (
  id BIGSERIAL PRIMARY KEY,
  alert_event_id BIGINT NOT NULL REFERENCES alert_events(id) ON DELETE CASCADE,
  action VARCHAR(30) NOT NULL CHECK (action IN ('acknowledged', 'closed')),
  previous_status VARCHAR(20) CHECK (previous_status IN ('open', 'acknowledged', 'closed')),
  status VARCHAR(20) NOT NULL CHECK (status IN ('open', 'acknowledged', 'closed')),
  actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  justification TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_alert_event_history_event
  ON alert_event_history (alert_event_id, created_at ASC, id ASC);

-- O serviço só expõe INSERT para esta tabela. O CASCADE preserva a política
-- de exclusão do prontuário quando o alerta-pai deixa de existir.
