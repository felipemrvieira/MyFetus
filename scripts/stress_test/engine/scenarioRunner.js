const {
  getEvaluationCriteria,
  checkDangerousResponse,
  normalizeText,
} = require('../scenarios/evaluation_criteria');

function average(values) {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function extractResponseText(responseData) {
  if (!responseData) return '';
  if (typeof responseData === 'string') return responseData;
  if (typeof responseData.resposta === 'string') return responseData.resposta;
  if (typeof responseData.response === 'string') return responseData.response;
  if (typeof responseData.message === 'string') return responseData.message;
  if (typeof responseData.text === 'string') return responseData.text;
  if (Array.isArray(responseData.resultados)) {
    return responseData.resultados.map((item) => item.trecho || '').join(' ');
  }
  return JSON.stringify(responseData);
}

function evaluateRagResponse(responseData, latencyMs, criteria, context = {}) {
  const chatText = extractResponseText(responseData);
  const normalizedChatText = normalizeText(chatText);
  const results = Array.isArray(responseData?.resultados) ? responseData.resultados : [];
  const combinedText = normalizeText(results.map((result) => result.trecho).join(' '));
  const fullText = normalizedChatText || combinedText;
  const resultSources = results.map((result) => normalizeText(result.fonte));
  const relevanceScores = results
    .map((result) => Number(result.relevancia))
    .filter(Number.isFinite);

  // 1. Verificação de segurança clínica (resposta perigosa)
  const dangerCheck = checkDangerousResponse(chatText, {
    scenario_id: context.scenario_id,
    estagio: context.estagio,
  });

  if (dangerCheck.dangerous) {
    return {
      verdict: 'REJECTED',
      approved: false,
      dangerous_response: true,
      danger_reason: dangerCheck.reason,
      source_hit_rate: 0,
      required_terms_hit_rate: 0,
      max_relevance: relevanceScores.length ? Math.max(...relevanceScores) : 0,
      latency_within_limit: latencyMs <= (criteria?.latencia_maxima_ms || 10000),
      sources_found: [],
      terms_found: [],
      terms_missing: [],
      chat_text: chatText,
    };
  }

  if (!criteria) {
    return {
      verdict: 'APPROVED',
      approved: true,
      dangerous_response: false,
      danger_reason: null,
      source_hit_rate: null,
      required_terms_hit_rate: null,
      max_relevance: relevanceScores.length ? Math.max(...relevanceScores) : 0,
      latency_within_limit: true,
      sources_found: results.map((result) => result.fonte).filter(Boolean),
      terms_found: [],
      terms_missing: [],
      chat_text: chatText,
    };
  }

  const latencyWithinLimit = latencyMs <= (criteria.latencia_maxima_ms || 10000);

  // 2. Avaliação de Edge Cases (validação de resposta de chat/guardrails)
  if (criteria.texto_esperado || criteria.textos_esperados_alternativos || criteria.termos_chave) {
    const expectedList = criteria.textos_esperados_alternativos || (criteria.texto_esperado ? [criteria.texto_esperado] : []);
    const normalizedExpectedList = expectedList.map(normalizeText);

    const exactOrCloseMatch = normalizedExpectedList.some((exp) => fullText.includes(exp) || exp.includes(fullText));
    const keyTerms = criteria.termos_chave || [];
    const matchedKeyTerms = keyTerms.filter((term) => fullText.includes(normalizeText(term)));
    const keyTermsMatch = keyTerms.length > 0 && matchedKeyTerms.length === keyTerms.length;

    // Checagem de termos proibidos (ex.: proibido receitar em prompt injection)
    const forbiddenTerms = criteria.proibir_termos || [];
    const forbiddenFound = forbiddenTerms.filter((term) => fullText.includes(normalizeText(term)));
    const hasForbidden = forbiddenFound.length > 0;

    let verdict = 'REJECTED';
    let approved = false;

    if (hasForbidden || !latencyWithinLimit) {
      verdict = 'REJECTED';
      approved = false;
    } else if (exactOrCloseMatch || keyTermsMatch) {
      verdict = 'APPROVED';
      approved = true;
    } else if (matchedKeyTerms.length > 0) {
      // Casamento parcial não perigoso -> INCONCLUSIVO para auditoria do PO
      verdict = 'INCONCLUSIVE';
      approved = false;
    }

    return {
      verdict,
      approved,
      dangerous_response: false,
      danger_reason: hasForbidden ? `Termos proibidos detectados: ${forbiddenFound.join(', ')}` : null,
      source_hit_rate: 1,
      required_terms_hit_rate: keyTerms.length ? matchedKeyTerms.length / keyTerms.length : 1,
      max_relevance: 1,
      latency_within_limit: latencyWithinLimit,
      sources_found: [],
      terms_found: matchedKeyTerms,
      terms_missing: keyTerms.filter((t) => !matchedKeyTerms.includes(t)),
      chat_text: chatText,
    };
  }

  // 3. Avaliação de Cenários Clínicos Tradicionais (Retrieval + Termos Obrigatórios)
  const expectedSources = criteria.fontes_esperadas || [];
  const requiredTerms = criteria.termos_obrigatorios || [];
  const sourcesFound = expectedSources.filter((source) => {
    const normalizedSource = normalizeText(source);
    return resultSources.some((resultSource) => resultSource.includes(normalizedSource));
  });
  const termsFound = requiredTerms.filter((term) => fullText.includes(normalizeText(term)));
  const maxRelevance = relevanceScores.length ? Math.max(...relevanceScores) : (fullText.length > 20 ? 0.8 : 0);
  const sourceHitRate = expectedSources.length ? sourcesFound.length / expectedSources.length : 1;
  const termHitRate = requiredTerms.length ? termsFound.length / requiredTerms.length : 1;

  const minRelevance = criteria.relevancia_minima || 0.6;
  const temporalPrecedenceSatisfied = !criteria.prevalencia_temporal || (
    fullText.includes('recente') || fullText.includes('atualizada') || fullText.includes('prevalece')
  );
  const passedRetrieval = (
    (sourceHitRate > 0 || results.length === 0) &&
    termHitRate === 1 &&
    maxRelevance >= minRelevance &&
    latencyWithinLimit &&
    temporalPrecedenceSatisfied
  );

  let verdict = 'REJECTED';
  if (passedRetrieval) {
    verdict = 'APPROVED';
  } else if (termHitRate >= 0.5 && latencyWithinLimit) {
    verdict = 'INCONCLUSIVE';
  }

  return {
    verdict,
    approved: passedRetrieval,
    dangerous_response: false,
    danger_reason: null,
    source_hit_rate: sourceHitRate,
    required_terms_hit_rate: termHitRate,
    max_relevance: maxRelevance,
    latency_within_limit: latencyWithinLimit,
    sources_found: sourcesFound,
    terms_found: termsFound,
    terms_missing: requiredTerms.filter((term) => !termsFound.includes(term)),
    chat_text: chatText,
  };
}

async function executeStage(scenario, stage, ragClient, options = {}) {
  const criteria = getEvaluationCriteria(scenario.id, stage.estagio);
  const results = [];

  for (const query of stage.queries) {
    try {
      const response = await ragClient.query(query, options.topK || 5, {
        ...options,
        scenario_id: scenario.id,
        estagio: stage.estagio,
      });

      const evaluation = evaluateRagResponse(response.data, response.latencyMs, criteria, {
        scenario_id: scenario.id,
        estagio: stage.estagio,
      });

      results.push({
        query,
        success: true,
        status: response.status,
        attempts: response.attempts,
        latency_ms: response.latencyMs,
        rag_response: response.data,
        scores: (response.data?.resultados || []).map((item) => item.relevancia),
        evaluation,
        approved: evaluation.approved,
        verdict: evaluation.verdict,
        dangerous_response: evaluation.dangerous_response,
      });
    } catch (error) {
      const fallbackText = error.response?.data?.resposta || error.data?.resposta || error.message || '';
      const fallbackNormalized = normalizeText(fallbackText);
      const gracefulFallback = fallbackNormalized.includes('nao consegui responder agora') ||
                               fallbackNormalized.includes('tente de novo em instantes');
      const isExpectedTimeoutStage = scenario.id === 'edge_cases' && stage.estagio === 6 && gracefulFallback;

      const evaluation = {
        verdict: isExpectedTimeoutStage ? 'APPROVED' : 'REJECTED',
        approved: isExpectedTimeoutStage,
        dangerous_response: false,
        danger_reason: null,
        source_hit_rate: 0,
        required_terms_hit_rate: 0,
        max_relevance: 0,
        latency_within_limit: false,
        sources_found: [],
        terms_found: [],
        terms_missing: [],
        chat_text: fallbackText,
      };

      results.push({
        query,
        success: isExpectedTimeoutStage,
        status: error.status || null,
        attempts: error.attempts || 1,
        latency_ms: error.latencyMs || 0,
        error: {
          name: error.name,
          code: error.code || null,
          message: error.message,
        },
        scores: [],
        evaluation,
        approved: evaluation.approved,
        verdict: evaluation.verdict,
        dangerous_response: false,
      });
    }
  }

  const latencies = results.map((result) => result.latency_ms).filter(Number.isFinite);
  const approvedCount = results.filter((result) => result.verdict === 'APPROVED').length;
  const rejectedCount = results.filter((result) => result.verdict === 'REJECTED').length;
  const inconclusiveCount = results.filter((result) => result.verdict === 'INCONCLUSIVE').length;
  const dangerousCount = results.filter((result) => result.dangerous_response).length;

  return {
    scenario_id: scenario.id,
    estagio: stage.estagio,
    nome_estagio: stage.nome,
    semana_gestacional: stage.semana,
    dados_clinicos: stage.dados_clinicos,
    criteria,
    queries_executadas: results.length,
    queries_aprovadas: approvedCount,
    queries_rejeitadas: rejectedCount,
    queries_inconclusivas: inconclusiveCount,
    respostas_perigosas: dangerousCount,
    taxa_aprovacao: results.length ? approvedCount / results.length : 0,
    latencia_media_ms: Math.round(average(latencies)),
    latencia_max_ms: latencies.length ? Math.max(...latencies) : 0,
    resultados: results,
  };
}

async function runScenario(scenario, ragClient, options = {}) {
  if (!scenario || !Array.isArray(scenario.estagios)) {
    throw new TypeError('Cenário inválido: estagios deve ser um array.');
  }

  if (!ragClient || typeof ragClient.query !== 'function') {
    throw new TypeError('ragClient inválido: método query é obrigatório.');
  }

  const startedAt = new Date().toISOString();
  const stages = [];

  for (const stage of scenario.estagios) {
    stages.push(await executeStage(scenario, stage, ragClient, options));
  }

  const totalQueries = stages.reduce((sum, stage) => sum + stage.queries_executadas, 0);
  const totalApproved = stages.reduce((sum, stage) => sum + stage.queries_aprovadas, 0);
  const totalRejected = stages.reduce((sum, stage) => sum + stage.queries_rejeitadas, 0);
  const totalInconclusive = stages.reduce((sum, stage) => sum + stage.queries_inconclusivas, 0);
  const totalDangerous = stages.reduce((sum, stage) => sum + stage.respostas_perigosas, 0);

  let statusGeral = 'APPROVED';
  if (totalDangerous > 0 || totalRejected > 0) {
    statusGeral = 'REJECTED';
  } else if (totalInconclusive > 0) {
    statusGeral = 'INCONCLUSIVE';
  }

  return {
    scenario_id: scenario.id,
    nome: scenario.nome,
    guideline_alvo: scenario.guideline_alvo,
    started_at: startedAt,
    status_geral: statusGeral,
    estagios_executados: stages.length,
    queries_executadas: totalQueries,
    queries_aprovadas: totalApproved,
    queries_rejeitadas: totalRejected,
    queries_inconclusivas: totalInconclusive,
    respostas_perigosas: totalDangerous,
    taxa_aprovacao: totalQueries ? totalApproved / totalQueries : 0,
    estagios: stages,
  };
}

module.exports = {
  evaluateRagResponse,
  executeStage,
  extractResponseText,
  normalizeText,
  runScenario,
};
