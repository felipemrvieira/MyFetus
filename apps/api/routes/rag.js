/**
 * rag.js
 * 
 * Rotas para o sistema RAG (Retrieval-Augmented Generation)
 * Endpoints de busca semântica e consulta ao knowledge base
 */

const express = require('express');
const router = express.Router();

const { rateLimit } = require('express-rate-limit');
const { authenticateToken, requireRole } = require('../middlewares/auth');
const { createAiLimiterOptions } = require('../middlewares/authRateLimit');
const { createAiUsageMiddleware } = require('../middlewares/aiUsage');
const {
  askClinicalAgentsChat,
  searchKnowledgeBase,
  askClinicalChat,
  getRAGStats,
} = require('../controllers/ragController');

router.use(rateLimit(createAiLimiterOptions()));

// Busca semântica no knowledge base (requer autenticação)
router.post('/search', authenticateToken, createAiUsageMiddleware({ operation: 'rag_search' }), searchKnowledgeBase);

// Chat clínico: retrieval + geração de resposta em linguagem natural (requer autenticação)
router.post('/chat', authenticateToken, createAiUsageMiddleware({ operation: 'rag_chat' }), askClinicalChat);
router.post('/chat/agents', authenticateToken, createAiUsageMiddleware({ operation: 'rag_agents' }), askClinicalAgentsChat);

// Estatísticas do RAG (admin only)
router.get('/stats', authenticateToken, requireRole('admin'), getRAGStats);

module.exports = router;
