-- E6-01.1 (#176) - registro de consulta com histórico por adendo.
-- Os campos clínicos em texto são cifrados pela camada de aplicação.

CREATE TABLE IF NOT EXISTS consultations (
  id SERIAL PRIMARY KEY,
  pregnancy_id INTEGER NOT NULL REFERENCES pregnancies(id) ON DELETE CASCADE,
  author_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  parent_consultation_id INTEGER REFERENCES consultations(id) ON DELETE RESTRICT,
  version INTEGER NOT NULL DEFAULT 1,
  status VARCHAR(20) NOT NULL DEFAULT 'draft',
  consultation_at TIMESTAMPTZ NOT NULL,
  gestational_age_weeks NUMERIC(4, 1),
  evolution TEXT NOT NULL,
  conduct TEXT NOT NULL,
  prescription_text TEXT,
  next_return_at DATE,
  finalized_at TIMESTAMPTZ,
  encryption_key_version INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT consultations_status_check
    CHECK (status IN ('draft', 'finalized')),
  CONSTRAINT consultations_version_check
    CHECK (version >= 1),
  CONSTRAINT consultations_gestational_age_check
    CHECK (gestational_age_weeks IS NULL OR gestational_age_weeks > 0),
  CONSTRAINT consultations_finalized_at_check
    CHECK ((status = 'draft' AND finalized_at IS NULL) OR
           (status = 'finalized' AND finalized_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_consultations_pregnancy_date
  ON consultations (pregnancy_id, consultation_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_consultations_parent
  ON consultations (parent_consultation_id);

DROP TRIGGER IF EXISTS update_consultations_updated_at ON consultations;
CREATE OR REPLACE FUNCTION update_consultations_updated_at_only()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_consultations_updated_at
  BEFORE UPDATE ON consultations
  FOR EACH ROW
  EXECUTE PROCEDURE update_consultations_updated_at_only();
