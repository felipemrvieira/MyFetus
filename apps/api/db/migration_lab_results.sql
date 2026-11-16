-- E2-04: resultados laboratoriais extraídos dos exames e a revisão médica.
-- Os valores clínicos são TEXT porque recebem envelopes AES da aplicação.
-- original_* guarda o que o parser leu e nunca muda; os campos sem prefixo são
-- os valores vigentes depois da revisão. Cada decisão gera uma linha em
-- lab_result_reviews, que é o histórico de versões.

CREATE TABLE IF NOT EXISTS lab_results (
  id BIGSERIAL PRIMARY KEY,
  document_id INTEGER NOT NULL REFERENCES pregnant_documents(id) ON DELETE CASCADE,
  pregnant_id INTEGER NOT NULL REFERENCES pregnants(id) ON DELETE CASCADE,
  line_index INTEGER NOT NULL,
  analyte_id VARCHAR(40) NOT NULL,
  loinc VARCHAR(20),
  raw_text TEXT,
  original_value TEXT,
  original_unit TEXT,
  original_reference_low TEXT,
  original_reference_high TEXT,
  original_observed_at TEXT,
  original_exam_type VARCHAR(20),
  original_timepoint VARCHAR(10),
  confidence NUMERIC(3, 2),
  ambiguity_reason VARCHAR(40),
  parser_version VARCHAR(20),
  extraction_method VARCHAR(80),
  value TEXT,
  unit TEXT,
  reference_low TEXT,
  reference_high TEXT,
  observed_at TEXT,
  exam_type VARCHAR(20),
  timepoint VARCHAR(10),
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  version INTEGER NOT NULL DEFAULT 1,
  review_reason TEXT,
  reviewed_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  encryption_key_version INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT lab_results_status_check CHECK (status IN ('pending', 'accepted', 'corrected', 'rejected')),
  CONSTRAINT lab_results_version_positive CHECK (version > 0),
  CONSTRAINT lab_results_exam_type_check CHECK (exam_type IS NULL OR exam_type IN ('fasting', 'casual', 'ogtt75g')),
  CONSTRAINT lab_results_timepoint_check CHECK (timepoint IS NULL OR timepoint IN ('0h', '1h', '2h')),
  CONSTRAINT lab_results_document_line_unique UNIQUE (document_id, line_index)
);

CREATE INDEX IF NOT EXISTS idx_lab_results_document
  ON lab_results (document_id, line_index);

CREATE INDEX IF NOT EXISTS idx_lab_results_pregnant_status
  ON lab_results (pregnant_id, status, analyte_id);

DROP TRIGGER IF EXISTS trg_lab_results_updated_at ON lab_results;
CREATE TRIGGER trg_lab_results_updated_at
  BEFORE UPDATE ON lab_results
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TABLE IF NOT EXISTS lab_result_reviews (
  id BIGSERIAL PRIMARY KEY,
  lab_result_id BIGINT NOT NULL REFERENCES lab_results(id) ON DELETE CASCADE,
  pregnant_id INTEGER NOT NULL REFERENCES pregnants(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  action VARCHAR(20) NOT NULL,
  previous_status VARCHAR(20) NOT NULL,
  new_status VARCHAR(20) NOT NULL,
  snapshot TEXT,
  reason TEXT,
  reviewed_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  encryption_key_version INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT lab_result_reviews_action_check CHECK (action IN ('accept', 'correct', 'reject', 'reopen')),
  CONSTRAINT lab_result_reviews_version_unique UNIQUE (lab_result_id, version)
);

CREATE INDEX IF NOT EXISTS idx_lab_result_reviews_result
  ON lab_result_reviews (lab_result_id, version DESC);
