/**
 * Executor do eval set do RAG (E4-06.2, #172; issue-pai #131).
 *
 * Roda cada pergunta sintética pelo mesmo caminho do chat e registra resposta,
 * fontes, latência, tokens, erro e versões. Decisões do P.O. em 15/11/2026 na #131:
 *   - o resultado vai em planilha, que o P.O. marca como aprovada, corrigir ou perigosa;
 *   - a CI roda simulada; a execução real é opt-in, só com perguntas sintéticas;
 *   - pergunta clínica sem fonte conta como falha de recuperação, separada de
 *     falha de geração.
 *
 * O gabarito fica em arquivo separado e só entra na planilha, ao lado da
 * resposta, para o P.O. comparar; ele nunca é enviado ao modelo.
 * O cálculo da meta (>= 90% aprovadas, 0 perigosas) é da E4-06.4 (#174).
 */
const { sanitizeForLLM } = require('../utils/piiSanitizer');

const CATEGORIES = Object.freeze(['comum', 'fora_de_escopo', 'alarme']);
const CLINICAL_CATEGORIES = Object.freeze(['comum', 'alarme']);
const EXPECTED_COMPOSITION = Object.freeze({ comum: 30, fora_de_escopo: 10, alarme: 10 });
const STATUSES = Object.freeze(['ok', 'blocked_by_guardrail', 'retrieval_failure', 'generation_failure']);
const GABARITO_FIELDS = Object.freeze(['resposta_esperada', 'fontes_minimas', 'risco', 'gabarito']);
const VERDICTS = Object.freeze(['aprovada', 'corrigir', 'perigosa']);
const MAX_QUESTION_LENGTH = 500;

class RagEvalError extends Error {
  constructor(message, problems = []) {
    super(message);
    this.name = 'RagEvalError';
    this.problems = problems;
  }
}

/** Confere o arquivo de perguntas. Erros impedem a execução; avisos não. */
function validateDataset(dataset) {
  const errors = [];
  const warnings = [];
  if (!dataset || typeof dataset !== 'object') {
    return { errors: ['O arquivo de perguntas precisa ser um objeto JSON.'], warnings };
  }
  if (dataset.sintetico !== true) errors.push('O eval set precisa declarar "sintetico": true (só perguntas sintéticas).');
  if (!dataset.versao) errors.push('Informe a "versao" do eval set.');
  const perguntas = Array.isArray(dataset.perguntas) ? dataset.perguntas : null;
  if (!perguntas || perguntas.length === 0) {
    errors.push('"perguntas" precisa ser uma lista com pelo menos uma pergunta.');
    return { errors, warnings };
  }

  const ids = new Set();
  const counts = Object.fromEntries(CATEGORIES.map((category) => [category, 0]));
  perguntas.forEach((item, index) => {
    const label = item?.id ? `Pergunta ${item.id}` : `Pergunta na posição ${index + 1}`;
    if (!item?.id || typeof item.id !== 'string') errors.push(`${label}: falta o "id".`);
    else if (ids.has(item.id)) errors.push(`${label}: id repetido.`);
    else ids.add(item.id);
    if (!CATEGORIES.includes(item?.categoria)) {
      errors.push(`${label}: categoria inválida (use ${CATEGORIES.join(', ')}).`);
    } else {
      counts[item.categoria] += 1;
    }
    const text = typeof item?.pergunta === 'string' ? item.pergunta.trim() : '';
    if (!text) errors.push(`${label}: falta o texto da pergunta.`);
    else if (text.length > MAX_QUESTION_LENGTH) errors.push(`${label}: pergunta com mais de ${MAX_QUESTION_LENGTH} caracteres.`);
    else if (sanitizeForLLM(text) !== text) errors.push(`${label}: parece ter dado pessoal ou identificável (documento, telefone, e-mail ou data). Use perguntas sintéticas sem esses dados.`);
    const leaked = GABARITO_FIELDS.filter((field) => item && field in item);
    if (leaked.length > 0) errors.push(`${label}: o gabarito (${leaked.join(', ')}) fica no arquivo separado.`);
  });

  const total = perguntas.length;
  const expectedTotal = Object.values(EXPECTED_COMPOSITION).reduce((sum, value) => sum + value, 0);
  if (total !== expectedTotal || CATEGORIES.some((category) => counts[category] !== EXPECTED_COMPOSITION[category])) {
    warnings.push(
      `Composição ${CATEGORIES.map((c) => `${counts[c]} ${c}`).join(', ')}; o combinado na #131 é `
      + `${CATEGORIES.map((c) => `${EXPECTED_COMPOSITION[c]} ${c}`).join(', ')}.`
    );
  }
  return { errors, warnings, counts };
}

function assertValidDataset(dataset) {
  const { errors, warnings } = validateDataset(dataset);
  if (errors.length > 0) throw new RagEvalError('Eval set inválido.', errors);
  return warnings;
}

function hasDisclaimer(text, disclaimer) {
  return Boolean(disclaimer) && String(text || '').includes(disclaimer);
}

function errorCode(error) {
  return error?.code || error?.name || 'ERROR';
}

/**
 * Classifica o resultado de uma pergunta. `outcome` vem do pipeline:
 * { resposta, semFonte, citacoes, usage, timings, blockedBy? }.
 */
function classifyOutcome(outcome) {
  if (outcome.blockedBy) return 'blocked_by_guardrail';
  if (outcome.semFonte) return 'retrieval_failure';
  if (!String(outcome.resposta || '').trim()) return 'generation_failure';
  return 'ok';
}

/**
 * Executa as perguntas em sequência (o plano gratuito tem limite por minuto).
 * `answer(pergunta)` é o pipeline do chat; `classify(pergunta)` é o guardrail,
 * registrado só como informação.
 */
async function runEval({
  dataset,
  answer,
  classify = () => null,
  disclaimer = null,
  clock = () => Number(process.hrtime.bigint() / 1000000n),
  pauseMs = 0,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  onProgress = () => {},
}) {
  assertValidDataset(dataset);
  const results = [];
  for (const [index, item] of dataset.perguntas.entries()) {
    if (index > 0 && pauseMs > 0) await sleep(pauseMs);
    const started = clock();
    const guardrail = classify(item.pergunta);
    const base = {
      id: item.id,
      categoria: item.categoria,
      pergunta: item.pergunta,
      guardrail_categoria: guardrail?.category || null,
    };
    let result;
    try {
      const outcome = await answer(item.pergunta);
      result = {
        ...base,
        status: classifyOutcome(outcome),
        resposta: outcome.resposta || '',
        citacoes: (outcome.citacoes || []).map(({ numero, documento_id, titulo, pagina, secao }) => ({
          numero, documento_id, titulo, pagina, secao,
        })),
        latencia_ms: Math.max(0, Math.round(clock() - started)),
        retrieval_ms: outcome.timings?.retrieval_ms ?? null,
        generation_ms: outcome.timings?.generation_ms ?? null,
        tokens: outcome.usage || null,
        modelo: outcome.model || null,
        prompt: outcome.promptVersion || null,
        versoes_manifesto: outcome.manifestVersions || [],
        disclaimer_presente: hasDisclaimer(outcome.resposta, disclaimer),
        erro: null,
      };
    } catch (error) {
      result = {
        ...base,
        status: error?.stage === 'retrieval' ? 'retrieval_failure' : 'generation_failure',
        resposta: '',
        citacoes: [],
        latencia_ms: Math.max(0, Math.round(clock() - started)),
        retrieval_ms: null,
        generation_ms: null,
        tokens: null,
        modelo: null,
        prompt: null,
        versoes_manifesto: [],
        disclaimer_presente: false,
        erro: errorCode(error),
      };
    }
    results.push(result);
    onProgress(result, index + 1, dataset.perguntas.length);
  }
  return results;
}

function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)];
}

function summarize(results) {
  const byStatus = Object.fromEntries(STATUSES.map((status) => [status, 0]));
  const byCategory = {};
  let tokens = 0;
  let tokensKnown = false;
  for (const result of results) {
    byStatus[result.status] += 1;
    byCategory[result.categoria] ||= Object.fromEntries(STATUSES.map((status) => [status, 0]));
    byCategory[result.categoria][result.status] += 1;
    if (Number.isFinite(result.tokens?.total_tokens)) {
      tokens += result.tokens.total_tokens;
      tokensKnown = true;
    }
  }
  const latencies = results.map((result) => result.latencia_ms).filter(Number.isFinite).sort((a, b) => a - b);
  return {
    total: results.length,
    por_status: byStatus,
    por_categoria: byCategory,
    // Decisão do P.O.: pergunta clínica sem fonte é falha de recuperação.
    falhas_de_recuperacao_clinicas: results.filter(
      (result) => result.status === 'retrieval_failure' && CLINICAL_CATEGORIES.includes(result.categoria)
    ).length,
    sem_disclaimer: results.filter((result) => result.status === 'ok' && !result.disclaimer_presente).length,
    latencia_ms: {
      media: latencies.length ? Math.round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length) : null,
      p50: percentile(latencies, 50),
      p95: percentile(latencies, 95),
      max: latencies.length ? latencies[latencies.length - 1] : null,
    },
    tokens_total: tokensKnown ? tokens : null,
  };
}

function csvCell(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return /[;"\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function formatSources(citacoes) {
  return citacoes
    .map((c) => `[${c.numero}] ${c.titulo || c.documento_id}${c.pagina ? `, p. ${c.pagina}` : ''}${c.secao ? `, ${c.secao}` : ''}`)
    .join(' | ');
}

const CSV_COLUMNS = Object.freeze([
  'id', 'categoria', 'pergunta', 'resposta_esperada', 'resposta', 'fontes', 'status', 'guardrail',
  'latencia_ms', 'tokens_total', 'disclaimer', 'erro', 'avaliacao', 'comentario', 'avaliador',
]);

/**
 * Planilha para o P.O. (separador ";" e BOM, para abrir certo no Excel em
 * português). As colunas avaliacao, comentario e avaliador ficam em branco
 * para ele preencher (aprovada, corrigir ou perigosa).
 */
function toCsv(results, gabarito = {}) {
  const rows = results.map((result) => [
    result.id,
    result.categoria,
    result.pergunta,
    gabarito[result.id]?.resposta_esperada ?? '',
    result.resposta,
    formatSources(result.citacoes),
    result.status,
    result.guardrail_categoria ?? '',
    result.latencia_ms,
    result.tokens?.total_tokens ?? '',
    result.status === 'ok' ? (result.disclaimer_presente ? 'sim' : 'não') : '',
    result.erro ?? '',
    '',
    '',
    '',
  ]);
  return `﻿${[CSV_COLUMNS, ...rows].map((row) => row.map(csvCell).join(';')).join('\r\n')}\r\n`;
}

function toNdjson(results) {
  return `${results.map((result) => JSON.stringify(result)).join('\n')}\n`;
}

/** Lê o gabarito separado: { versao, respostas: [{ id, resposta_esperada, ... }] }. */
function indexGabarito(gabarito) {
  if (!gabarito) return {};
  const entries = Array.isArray(gabarito.respostas) ? gabarito.respostas : [];
  return Object.fromEntries(entries.filter((entry) => entry?.id).map((entry) => [entry.id, entry]));
}

module.exports = {
  CATEGORIES,
  CSV_COLUMNS,
  EXPECTED_COMPOSITION,
  RagEvalError,
  STATUSES,
  VERDICTS,
  assertValidDataset,
  classifyOutcome,
  indexGabarito,
  runEval,
  summarize,
  toCsv,
  toNdjson,
  validateDataset,
};
