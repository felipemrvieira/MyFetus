/**
 * Rotas relacionadas à manipulação de documentos de gestantes.
 *
 * Definição:
 *   Fornece endpoints para upload, listagem, consulta, atualização e exclusão de documentos.
 *   Utiliza o controller `documentsController` para tratar as requisições.
 *
 * Endpoints:
 *   - POST   /         : Upload de um documento (campo 'file' ou 'document').
 *   - GET    /         : Lista documentos filtrando por `pregnant_id` (query param).
 *   - GET    /:id      : Consulta um documento específico pelo ID.
 *   - GET    /:id/download : Baixa um documento específico pelo ID.
 *   - GET    /:id/text : Consulta o texto extraído do documento.
 *   - POST   /:id/extract : Reprocessa a extração de texto.
 *   - DELETE /:id      : Remove um documento pelo ID.
 *   - PUT    /:id      : Atualiza informações de um documento pelo ID.
 *
 * Observações:
 *   - O upload de arquivos é realizado temporariamente na pasta 'uploads/' via `multer`.
 *   - As rotas utilizam `express.Router` para modularização.
 */
const express = require('express');
const router = express.Router();
const multer = require('multer');
const { rateLimit } = require('express-rate-limit');

const {
  uploadDocument,
  getDocuments,
  getDocumentById,
  downloadDocument,
  deleteDocument,
  updateDocument,
  getDocumentExtractedText,
  retryDocumentTextExtraction,
} = require('../controllers/documentsController');
const { authenticateToken, requireRole } = require('../middlewares/auth');

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

const upload = multer({
  dest: 'uploads/',
  limits: {
    fileSize: Number(process.env.DOCUMENT_MAX_UPLOAD_BYTES || 25 * 1024 * 1024),
  },
});
const documentUploadLimiter = rateLimit({
  windowMs: positiveInteger(
    process.env.DOCUMENT_UPLOAD_RATE_LIMIT_WINDOW_MS,
    15 * 60 * 1000
  ),
  limit: positiveInteger(process.env.DOCUMENT_UPLOAD_RATE_LIMIT_MAX, 20),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
});
const documentReadLimiter = rateLimit({
  windowMs: positiveInteger(
    process.env.DOCUMENT_READ_RATE_LIMIT_WINDOW_MS,
    15 * 60 * 1000
  ),
  limit: positiveInteger(process.env.DOCUMENT_READ_RATE_LIMIT_MAX, 120),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
});
router.post(
  '/',
  documentUploadLimiter,
  authenticateToken,
  upload.fields([
    { name: 'file', maxCount: 1 },
    { name: 'document', maxCount: 1 },
  ]),
  uploadDocument
);
router.get('/', documentReadLimiter, authenticateToken, requireRole('gestante', 'medico', 'admin'), getDocuments); // lista por pregnant_id (query param)
router.get('/:id/download', documentReadLimiter, authenticateToken, requireRole('gestante', 'medico', 'admin'), downloadDocument);
router.get('/:id/text', documentReadLimiter, authenticateToken, requireRole('gestante', 'medico', 'admin'), getDocumentExtractedText);
router.post('/:id/extract', documentReadLimiter, authenticateToken, requireRole('medico', 'admin'), retryDocumentTextExtraction);
router.get('/:id', documentReadLimiter, authenticateToken, requireRole('gestante', 'medico', 'admin'), getDocumentById); // busca o doc por id
router.delete('/:id', documentReadLimiter, authenticateToken, requireRole('medico', 'admin'), deleteDocument);
router.put('/:id', documentReadLimiter, authenticateToken, requireRole('medico', 'admin'), updateDocument);

module.exports = router;
