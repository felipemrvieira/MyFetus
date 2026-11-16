#!/usr/bin/env node
/**
 * npm run rag:eval -- [opções]   (E4-06.2, #172)
 *
 * Roda o eval set do RAG e grava, numa pasta nova:
 *   - planilha.csv: uma linha por pergunta, com colunas em branco para o P.O.
 *     marcar aprovada, corrigir ou perigosa;
 *   - resultados.ndjson: o resultado completo de cada pergunta;
 *   - resumo.json: versões (commit, modelo, prompt, manifesto, eval set) e totais.
 *
 * Opções:
 *   --perguntas <arquivo>   eval set (padrão: data/rag-eval/perguntas.exemplo.json)
 *   --gabarito <arquivo>    respostas esperadas, só para a planilha (opcional)
 *   --modo mock|real        padrão mock (sem rede). real exige --confirmar-real
 *   --confirmar-real        autoriza chamar Pinecone e Gemini (plano gratuito)
 *   --caminho chat|agents   caminho avaliado (padrão chat, o que o app usa)
 *   --top-k <n>             trechos por pergunta (padrão 5)
 *   --intervalo-ms <n>      pausa entre perguntas (padrão 0 no mock, 6500 no real)
 *   --saida <pasta>         pasta de saída (padrão rag-eval-results/<data>-<modo>)
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const API_DIR = path.resolve(__dirname, '..');
const DEFAULT_DATASET = path.join(API_DIR, 'data', 'rag-eval', 'perguntas.exemplo.json');
const DEFAULT_REAL_PAUSE_MS = 6500;

function parseArgs(argv) {
  const options = {
    perguntas: DEFAULT_DATASET,
    gabarito: null,
    modo: 'mock',
    confirmarReal: false,
    caminho: 'chat',
    topK: 5,
    intervaloMs: null,
    saida: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) throw new Error(`Falta o valor de ${arg}.`);
      index += 1;
      return value;
    };
    if (arg === '--perguntas') options.perguntas = path.resolve(next());
    else if (arg === '--gabarito') options.gabarito = path.resolve(next());
    else if (arg === '--modo') options.modo = next();
    else if (arg === '--confirmar-real') options.confirmarReal = true;
    else if (arg === '--caminho') options.caminho = next();
    else if (arg === '--top-k') options.topK = Number(next());
    else if (arg === '--intervalo-ms') options.intervaloMs = Number(next());
    else if (arg === '--saida') options.saida = path.resolve(next());
    else throw new Error(`Opção desconhecida: ${arg}`);
  }
  if (!['mock', 'real'].includes(options.modo)) throw new Error('--modo deve ser mock ou real.');
  if (!['chat', 'agents'].includes(options.caminho)) throw new Error('--caminho deve ser chat ou agents.');
  if (!Number.isInteger(options.topK) || options.topK < 1 || options.topK > 20) throw new Error('--top-k deve ser de 1 a 20.');
  if (options.intervaloMs !== null && (!Number.isInteger(options.intervaloMs) || options.intervaloMs < 0)) {
    throw new Error('--intervalo-ms deve ser um inteiro >= 0.');
  }
  return options;
}

function readJson(file, label) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`Não foi possível ler ${label} (${path.relative(process.cwd(), file)}): ${error.message}`);
  }
}

function currentCommit() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: API_DIR, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return process.env.GITHUB_SHA || null;
  }
}

function timestampSlug(date) {
  return date.toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

/** Monta o pipeline avaliado. O modo real carrega os serviços só aqui. */
function buildPipeline({ modo, caminho, topK }) {
  const { SAFE_MESSAGES, classifyQuery } = require('../services/agents/guardrailService');
  const { buildCitations, manifestVersions, selectTraceableChunks } = require('../services/ragCitationService');
  const { createRagChatService } = require('../services/ragChatService');

  let retrieveChunks;
  let generateAnswerDetailed;
  let model;
  let promptVersion;
  if (modo === 'real') {
    const generationService = require('../services/generationService');
    retrieveChunks = require('../services/ragRetrievalService').retrieveChunks;
    generateAnswerDetailed = generationService.generateAnswerDetailed;
    model = generationService.GEMINI_MODEL;
    promptVersion = generationService.RAG_CHAT_PROMPT_VERSION;
  } else {
    const { createMockGenerator, mockRetrieveChunks } = require('../services/ragEvalMock');
    retrieveChunks = async (query) => mockRetrieveChunks(query);
    generateAnswerDetailed = createMockGenerator(SAFE_MESSAGES.disclaimer);
    model = 'mock';
    promptVersion = 'mock';
  }

  let answer;
  if (caminho === 'chat') {
    const chat = createRagChatService({ retrieveChunks, generateAnswerDetailed, model, promptVersion });
    answer = (pergunta) => chat.answer(pergunta, { topK });
  } else {
    const { runClinicalAgentGraph } = require('../services/agents/clinicalGraph');
    const dependencies = { retrieveChunks };
    if (modo === 'mock') {
      const mockAgent = async ({ query, retrieveChunks: retrieve }) => {
        const sources = await retrieve(query);
        return { analysis: sources.length ? (await generateAnswerDetailed(query, sources)).text : '', sources };
      };
      dependencies.analyzeMaternal = mockAgent;
      dependencies.analyzeFetal = mockAgent;
    }
    answer = async (pergunta) => {
      const state = await runClinicalAgentGraph({ query: pergunta, topK }, dependencies);
      const blockedBy = state.guardrail_decision && state.guardrail_decision !== 'allow_controlled_generation'
        ? state.guardrail_category
        : null;
      const citacoes = buildCitations(selectTraceableChunks(state.sources));
      return {
        resposta: state.final_response,
        semFonte: !blockedBy && citacoes.length === 0,
        blockedBy,
        citacoes,
        usage: null,
        timings: null,
        model: blockedBy ? null : model,
        promptVersion: blockedBy ? null : `agents-${promptVersion}`,
        manifestVersions: manifestVersions(citacoes),
      };
    };
  }

  return { answer, classify: classifyQuery, disclaimer: SAFE_MESSAGES.disclaimer, model, promptVersion };
}

async function main(argv = process.argv.slice(2), { now = () => new Date(), log = console.log } = {}) {
  const options = parseArgs(argv);
  const dataset = readJson(options.perguntas, 'o eval set');
  const gabarito = options.gabarito ? readJson(options.gabarito, 'o gabarito') : null;
  const evalService = require('../services/ragEvalService');

  const { errors, warnings } = evalService.validateDataset(dataset);
  if (errors.length > 0) {
    log('Eval set inválido:');
    errors.forEach((problem) => log(`  - ${problem}`));
    return 2;
  }
  warnings.forEach((warning) => log(`Aviso: ${warning}`));

  if (options.modo === 'real' && !options.confirmarReal) {
    log('O modo real chama Pinecone e Gemini. Rode de novo com --confirmar-real para autorizar.');
    return 2;
  }

  const started = now();
  const pipeline = buildPipeline(options);
  const pauseMs = options.intervaloMs ?? (options.modo === 'real' ? DEFAULT_REAL_PAUSE_MS : 0);
  log(`Rodando ${dataset.perguntas.length} perguntas (modo ${options.modo}, caminho ${options.caminho})...`);

  const results = await evalService.runEval({
    dataset,
    answer: pipeline.answer,
    classify: pipeline.classify,
    disclaimer: pipeline.disclaimer,
    pauseMs,
    onProgress: (result, done, total) => log(`  [${done}/${total}] ${result.id}: ${result.status}`),
  });

  const summary = evalService.summarize(results);
  const outDir = options.saida || path.join(API_DIR, 'rag-eval-results', `${timestampSlug(started)}-${options.modo}`);
  fs.mkdirSync(outDir, { recursive: true });
  const datasetRaw = fs.readFileSync(options.perguntas);
  const meta = {
    executado_em: started.toISOString(),
    commit: currentCommit(),
    modo: options.modo,
    caminho: options.caminho,
    top_k: options.topK,
    modelo: pipeline.model,
    prompt: pipeline.promptVersion,
    contrato_guardrails: require('../services/agents/guardrailService').GUARDRAIL_CONTRACT?.version ?? null,
    versoes_manifesto: [...new Set(results.flatMap((result) => result.versoes_manifesto))],
    eval_set: {
      arquivo: path.basename(options.perguntas),
      versao: dataset.versao,
      sha256: crypto.createHash('sha256').update(datasetRaw).digest('hex'),
      gabarito: options.gabarito ? path.basename(options.gabarito) : null,
    },
  };
  fs.writeFileSync(path.join(outDir, 'resultados.ndjson'), evalService.toNdjson(results));
  fs.writeFileSync(path.join(outDir, 'planilha.csv'), evalService.toCsv(results, evalService.indexGabarito(gabarito)));
  fs.writeFileSync(path.join(outDir, 'resumo.json'), `${JSON.stringify({ ...meta, resumo: summary }, null, 2)}\n`);

  log(`\nStatus: ${Object.entries(summary.por_status).map(([status, count]) => `${status}=${count}`).join(', ')}`);
  log(`Falhas de recuperação em perguntas clínicas: ${summary.falhas_de_recuperacao_clinicas}`);
  log(`Arquivos em ${path.relative(process.cwd(), outDir) || outDir}`);
  return 0;
}

if (require.main === module) {
  main()
    .then((code) => { process.exitCode = code; })
    .catch((error) => {
      console.error(`Erro: ${error.message}`);
      process.exitCode = 1;
    });
}

module.exports = { buildPipeline, main, parseArgs };
