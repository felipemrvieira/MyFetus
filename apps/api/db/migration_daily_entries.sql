-- E5-01.1: diário versionado da gestante.
-- Os campos clínicos são TEXT porque recebem envelopes AES da aplicação.

CREATE TABLE IF NOT EXISTS daily_entries (
  id BIGSERIAL PRIMARY KEY,
  entry_key TEXT NOT NULL,
  pregnant_id INTEGER NOT NULL REFERENCES pregnants(id) ON DELETE CASCADE,
  pregnancy_id INTEGER NOT NULL REFERENCES pregnancies(id) ON DELETE CASCADE,
  entry_date DATE NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'America/Recife',
  version INTEGER NOT NULL DEFAULT 1,
  is_current BOOLEAN NOT NULL DEFAULT TRUE,
  previous_version_id BIGINT REFERENCES daily_entries(id) ON DELETE RESTRICT,
  alarm_symptoms TEXT,
  other_symptoms TEXT,
  free_text TEXT,
  systolic TEXT,
  diastolic TEXT,
  weight_kg TEXT,
  glucose_mg_dl TEXT,
  reduced_fetal_movements TEXT,
  created_by_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  encryption_key_version INTEGER,
  CONSTRAINT daily_entries_version_positive CHECK (version > 0),
  CONSTRAINT daily_entries_timezone_length CHECK (char_length(timezone) BETWEEN 1 AND 80)
);

CREATE UNIQUE INDEX IF NOT EXISTS daily_entries_current_key_unique
  ON daily_entries (entry_key) WHERE is_current = TRUE;

CREATE INDEX IF NOT EXISTS idx_daily_entries_pregnancy_date
  ON daily_entries (pregnancy_id, entry_date DESC, id DESC)
  WHERE is_current = TRUE;

CREATE INDEX IF NOT EXISTS idx_daily_entries_pregnant
  ON daily_entries (pregnant_id, entry_date DESC, id DESC)
  WHERE is_current = TRUE;

DROP TRIGGER IF EXISTS trg_daily_entries_updated_at ON daily_entries;
CREATE TRIGGER trg_daily_entries_updated_at
  BEFORE UPDATE ON daily_entries
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
