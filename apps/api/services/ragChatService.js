/**
 * Caminho do chat simples (POST /api/internal/rag/chat): busca, seleção das
 * fontes rastreáveis, geração e citações (E4-04).
 *
 * Fica num serviço para que o controller e o executor do eval set (E4-06.2,
 * `npm run rag:eval`) avaliem exatamente o mesmo caminho. As dependências são
 * injetáveis, para o modo simulado do eval rodar sem rede.
 */
const { SAFE_MESSAGES } = require('./agents/guardrailService');
const {
  buildCitations,
  manifestVersions,
  selectTraceableChunks,
} = require('./ragCitationService');
const { sanitizeForLLM } = require('../utils/piiSanitizer');

function elapsedMs(clock, start) {
  return Math.max(0, Math.round(clock() - start));
}

function createRagChatService({
  retrieveChunks,
  generateAnswerDetailed,
  model = null,
  promptVersion = null,
  clock = () => Number(process.hrtime.bigint() / 1000000n),
} = {}) {
  if (typeof retrieveChunks !== 'function') throw new Error('retrieveChunks é obrigatório');
  if (typeof generateAnswerDetailed !== 'function') throw new Error('generateAnswerDetailed é obrigatório');

  /**
   * Responde uma pergunta. Erros da busca ou da geração sobem para o chamador,
   * marcados com `stage` ('retrieval' ou 'generation').
   */
  async function answer(query, { topK = 5, filters = {} } = {}) {
    // Remove identificadores pessoais antes de mandar a pergunta para o LLM externo.
    const sanitizedQuery = sanitizeForLLM(query);

    const retrievalStart = clock();
    let recuperados;
    try {
      recuperados = await retrieveChunks(sanitizedQuery, topK, filters);
    } catch (error) {
      error.stage = 'retrieval';
      throw error;
    }
    const retrievalMs = elapsedMs(clock, retrievalStart);

    // Só trechos rastreáveis (documento + página ou seção) vão ao modelo e viram citação.
    const trechos = selectTraceableChunks(recuperados);
    const semFonte = trechos.length === 0;

    let resposta = SAFE_MESSAGES.no_source;
    let usage = null;
    let generationMs = 0;
    if (!semFonte) {
      const generationStart = clock();
      try {
        const generated = await generateAnswerDetailed(sanitizedQuery, trechos);
        resposta = generated.text;
        usage = generated.usage || null;
      } catch (error) {
        error.stage = 'generation';
        throw error;
      }
      generationMs = elapsedMs(clock, generationStart);
    }

    const citacoes = buildCitations(trechos);
    return {
      sanitizedQuery,
      resposta,
      semFonte,
      recuperados,
      trechos,
      citacoes,
      usage,
      timings: { retrieval_ms: retrievalMs, generation_ms: generationMs },
      model: semFonte ? null : model,
      promptVersion: semFonte ? null : promptVersion,
      manifestVersions: manifestVersions(citacoes),
    };
  }

  return { answer };
}

module.exports = { createRagChatService };
