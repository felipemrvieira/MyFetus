/**
 * Revisão médica dos resultados laboratoriais extraídos (E2-04, #61).
 *
 * Só o médico vinculado à gestante lê e decide. O administrador não revisa
 * resultado clínico (decisão do P.O. em 29/10/2026), então as rotas aceitam
 * apenas o perfil médico.
 */
const client = require('../backend');
const cryptoService = require('../services/cryptoService');
const { audit } = require('../services/auditService');
const { doctorCanAccessPregnant } = require('../utils/clinicalAccess');
const { sendInternalError } = require('../utils/httpErrors');
const { LabResultError, createLabResultService } = require('../services/labResultService');

const labResults = createLabResultService({ crypto: cryptoService });

const AUDIT_ACTIONS = Object.freeze({
  accept: 'LAB_RESULT_ACCEPTED',
  correct: 'LAB_RESULT_CORRECTED',
  reject: 'LAB_RESULT_REJECTED',
  reopen: 'LAB_RESULT_REOPENED',
});

function positiveId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// As mensagens de LabResultError são textos fixos do serviço, feitos para a tela.
function labResultErrorBody(error) {
  const body = { error: error.message, code: error.code };
  if (error.details) Object.assign(body, error.details);
  return body;
}

async function ensureLinkedDoctor(req, res, pregnantId) {
  if (await doctorCanAccessPregnant(req.user.id, pregnantId)) return true;
  res.status(403).json({ error: 'Médico não vinculado a esta gestante' });
  return false;
}

function summarize(results) {
  const summary = { total: results.length, pending: 0, accepted: 0, corrected: 0, rejected: 0 };
  for (const result of results) summary[result.status] += 1;
  return summary;
}

async function getDocumentLabResults(req, res) {
  try {
    const documentId = positiveId(req.params.documentId);
    if (!documentId) return res.status(400).json({ error: 'documentId inválido' });

    const found = await client.query(
      `SELECT id, pregnant_id, document_name, extraction_status, extracted_text, uploaded_at, extracted_at
         FROM pregnant_documents
        WHERE id = $1`,
      [documentId]
    );
    if (!found.rows[0]) return res.status(404).json({ error: 'Documento não encontrado' });
    const document = cryptoService.decryptRecord(found.rows[0], 'pregnant_documents');
    if (!(await ensureLinkedDoctor(req, res, document.pregnant_id))) return;

    // Documentos extraídos antes desta etapa são estruturados na primeira abertura.
    if (document.extraction_status === 'done' && (await labResults.countDocumentResults(client, documentId)) === 0) {
      await labResults.ingestDocumentResults(client, {
        documentId,
        pregnantId: document.pregnant_id,
        text: document.extracted_text,
      });
    }

    const results = await labResults.listDocumentResults(client, documentId);
    return res.json({
      document: {
        id: document.id,
        pregnant_id: document.pregnant_id,
        document_name: document.document_name,
        extraction_status: document.extraction_status,
        uploaded_at: document.uploaded_at,
        extracted_at: document.extracted_at,
      },
      summary: summarize(results),
      results,
    });
  } catch (error) {
    return sendInternalError(res);
  }
}

async function getLabResultHistory(req, res) {
  try {
    const labResultId = positiveId(req.params.id);
    if (!labResultId) return res.status(400).json({ error: 'id inválido' });
    const found = await labResults.findResult(client, labResultId);
    if (!found) return res.status(404).json({ error: 'Resultado não encontrado' });
    if (!(await ensureLinkedDoctor(req, res, found.pregnant_id))) return;
    return res.json({ lab_result_id: labResultId, history: await labResults.listHistory(client, labResultId) });
  } catch (error) {
    return sendInternalError(res);
  }
}

function reviewLabResult(action) {
  return async function handleReview(req, res) {
    const labResultId = positiveId(req.params.id);
    try {
      if (!labResultId) return res.status(400).json({ error: 'id inválido' });
      const found = await labResults.findResult(client, labResultId);
      if (!found) return res.status(404).json({ error: 'Resultado não encontrado' });
      if (!(await ensureLinkedDoctor(req, res, found.pregnant_id))) return;

      const outcome = await labResults.reviewResult(client, {
        labResultId,
        action,
        payload: req.body || {},
        expectedVersion: req.body?.version,
        userId: req.user.id,
      });

      // O valor e a justificativa ficam cifrados em lab_result_reviews; aqui vai só o rastro.
      audit(req, {
        action: AUDIT_ACTIONS[action],
        resource: 'lab_results',
        resource_id: String(labResultId),
        detail: {
          analyte_id: outcome.analyteId,
          version: outcome.result.version,
          previous_status: outcome.previousStatus,
          new_status: outcome.result.status,
        },
      });
      return res.json({ result: outcome.result });
    } catch (error) {
      if (error instanceof LabResultError) {
        return res.status(error.status).json(labResultErrorBody(error));
      }
      return sendInternalError(res);
    }
  };
}

module.exports = {
  acceptLabResult: reviewLabResult('accept'),
  correctLabResult: reviewLabResult('correct'),
  getDocumentLabResults,
  getLabResultHistory,
  rejectLabResult: reviewLabResult('reject'),
  reopenLabResult: reviewLabResult('reopen'),
};
