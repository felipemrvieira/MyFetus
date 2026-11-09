-- E5-02: pesos informados no diario alimentam o historico sem duplicar retry.
ALTER TABLE maternal_weight_history
  ADD COLUMN IF NOT EXISTS source_daily_entry_key TEXT,
  ADD COLUMN IF NOT EXISTS source_daily_entry_version INTEGER;

CREATE UNIQUE INDEX IF NOT EXISTS maternal_weight_daily_source_unique
  ON maternal_weight_history (source_daily_entry_key, source_daily_entry_version)
  WHERE source_daily_entry_key IS NOT NULL;
