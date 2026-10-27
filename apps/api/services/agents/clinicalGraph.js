const { analyzeMaternal } = require('./maternalAgent');
const { analyzeFetal } = require('./fetalAgent');
const {
  CRITICAL_RULES,
  classifyQuery,
  normalize,
  routeInScope,
} = require('./guardrailService');
const { sanitizeForLLM } = require('../../utils/piiSanitizer');

function detectHumanReview(query) {
  const classification = classifyQuery(query);
  return {
    needs_human_review: classification.needs_human_review,
    ambiguity_reason: classification.needs_human_review ? classification.reason : null,
  };
}

function routeAgents(query) {
  const classification = classifyQuery(query);
  return classification.route || routeInScope(query);
}

function uniqueSources(sources) {
  const seen = new Set();
  return sources.filter((source) => {
    const key = [
      source.fonte,
      source.pagina,
      source.secao,
      source.documento_id,
    ].join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function synthesizeFinalResponse(state) {
  if (state.guardrail_response) return state.guardrail_response;
  if (state.needs_human_review) {
    return 'Pelos sinais descritos, esta situação precisa de avaliação humana imediata. Procure atendimento obstétrico presencial ou serviço de urgência, e leve seus registros de pré-natal.';
  }
  if (state.route === 'clarify') {
    return 'Preciso de mais detalhes para direcionar a análise com segurança. Informe semanas de gestação, sintoma principal e há quanto tempo isso ocorre.';
  }

  const parts = [];
  if (state.maternal_analysis) parts.push(`Análise materna: ${state.maternal_analysis}`);
  if (state.fetal_analysis) parts.push(`Análise fetal: ${state.fetal_analysis}`);
  return `${parts.join('\n\n')}\n\nEsta orientação não substitui consulta médica.`;
}

async function runClinicalAgentGraph(input, dependencies = {}) {
  const query = input.query;
  const sanitizedQuery = input.sanitized_query || sanitizeForLLM(query);
  const classification = classifyQuery(sanitizedQuery);
  const route = classification.route || { route: 'clarify', maternal: false, fetal: false };
  const state = {
    query,
    sanitized_query: sanitizedQuery,
    patient_context: input.patient_context || null,
    route: route.route,
    maternal_analysis: '',
    fetal_analysis: '',
    needs_human_review: classification.needs_human_review,
    ambiguity_reason: classification.reason,
    guardrail_category: classification.category,
    guardrail_decision: classification.decision,
    guardrail_response: classification.response,
    guardrail_contract_version: classification.contractVersion,
    final_response: '',
    sources: [],
  };

  if (classification.decision !== 'allow_controlled_generation') {
    state.final_response = synthesizeFinalResponse(state);
    return state;
  }

  const maternalRunner = dependencies.analyzeMaternal || analyzeMaternal;
  const fetalRunner = dependencies.analyzeFetal || analyzeFetal;
  const retrieveChunks = dependencies.retrieveChunks;
  const tasks = [];

  if (route.maternal) {
    tasks.push(
      maternalRunner({
        query: sanitizedQuery,
        patientContext: state.patient_context,
        retrieveChunks,
        topK: input.topK,
      }).then((result) => {
        state.maternal_analysis = result.analysis || '';
        state.sources.push(...(result.sources || []));
      })
    );
  }

  if (route.fetal) {
    tasks.push(
      fetalRunner({
        query: sanitizedQuery,
        patientContext: state.patient_context,
        retrieveChunks,
        topK: input.topK,
      }).then((result) => {
        state.fetal_analysis = result.analysis || '';
        state.sources.push(...(result.sources || []));
      })
    );
  }

  await Promise.all(tasks);
  state.sources = uniqueSources(state.sources);
  state.final_response = dependencies.synthesizeFinalResponse
    ? dependencies.synthesizeFinalResponse(state)
    : synthesizeFinalResponse(state);
  return state;
}

module.exports = {
  CRITICAL_RULES,
  detectHumanReview,
  normalize,
  routeAgents,
  runClinicalAgentGraph,
  synthesizeFinalResponse,
};
