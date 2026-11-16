-- E2-05: devolutiva médica versionada para a gestante.
-- O conteúdo clínico é cifrado pela aplicação; a classificação permanece clara
-- para validação, filtros e apresentação operacional.

CREATE TABLE IF NOT EXISTS document_reports (
  id BIGSERIAL PRIMARY KEY,
  document_id INTEGER NOT NULL REFERENCES pregnant_documents(id) ON DELETE CASCADE,
  pregnant_id INTEGER NOT NULL REFERENCES pregnants(id) ON DELETE CASCADE,
  author_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  version INTEGER NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'in_review',
  severity VARCHAR(30) NOT NULL,
  content TEXT NOT NULL,
  supersedes_report_id BIGINT REFERENCES document_reports(id) ON DELETE SET NULL,
  published_at TIMESTAMPTZ,
  encryption_key_version INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT document_reports_status_check CHECK (status IN ('in_review', 'published', 'replaced')),
  CONSTRAINT document_reports_severity_check CHECK (severity IN ('normal', 'attention', 'see_consultation', 'seek_care_today')),
  CONSTRAINT document_reports_version_positive CHECK (version > 0),
  CONSTRAINT document_reports_document_version_unique UNIQUE (document_id, version)
);

CREATE INDEX IF NOT EXISTS idx_document_reports_document_status
  ON document_reports (document_id, status, version DESC);

CREATE INDEX IF NOT EXISTS idx_document_reports_pregnant
  ON document_reports (pregnant_id, status, published_at DESC);

DROP TRIGGER IF EXISTS trg_document_reports_updated_at ON document_reports;
CREATE TRIGGER trg_document_reports_updated_at
  BEFORE UPDATE ON document_reports
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
