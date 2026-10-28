CREATE TABLE IF NOT EXISTS alert_events (
  id BIGSERIAL PRIMARY KEY,
  alert_key VARCHAR(80) NOT NULL UNIQUE,
  pregnancy_id INTEGER NOT NULL REFERENCES pregnancies(id) ON DELETE CASCADE,
  pregnant_id INTEGER NOT NULL REFERENCES pregnants(id) ON DELETE CASCADE,
  rule_id VARCHAR(120) NOT NULL,
  severity VARCHAR(10) NOT NULL CHECK (severity IN ('yellow', 'red')),
  status VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'acknowledged', 'closed')),
  source_type VARCHAR(30) NOT NULL CHECK (source_type IN ('daily_entry', 'lab_result', 'risk_engine')),
  source_id VARCHAR(120),
  message TEXT NOT NULL,
  signal_codes JSONB NOT NULL DEFAULT '[]'::jsonb,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  acknowledged_at TIMESTAMPTZ,
  acknowledged_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  closed_at TIMESTAMPTZ,
  closed_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  close_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_alert_events_pregnancy_status
  ON alert_events (pregnancy_id, status, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_alert_events_pregnant_status
  ON alert_events (pregnant_id, status, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_alert_events_rule
  ON alert_events (pregnancy_id, rule_id, severity, status);
