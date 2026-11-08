const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const {
  MAX_SNIPPET_CHARS,
  buildCitations,
  isTraceable,
  selectTraceableChunks,
  shortSnippet,
} = require('../services/ragCitationService');
const { mapMatch } = require('../services/ragRetrievalService');

function chunk(overrides = {}) {
  return {
    trecho: 'Na gestação, procure a maternidade se houver sangramento vaginal, dor de cabeça forte ou visão turva.',
    fonte: 'Caderneta brasileira da gestante',
    titulo: 'Caderneta brasileira da gestante',
    emissor: 'Ministério da Saúde',
    edicao: '1ª edição',
    ano: 2026,
    pagina: 12,
    secao: 'sinais de alerta',
    relevancia: 0.8731,
    documento_id: 'caderneta-gestante-ms-2026',
    url: 'https://www.gov.br/saude/caderneta.pdf',
    versao_manifesto: '2026.10.1',
    ...overrides,
  };
}

test.describe('Citações das respostas (regras puras)', () => {
  test('a busca leva título, órgão, ano, página, URL e versão do manifesto', () => {
    const mapped = mapMatch({
      score: 0.81234,
      metadata: {
        text: 'trecho', source: 'Caderneta', title: 'Caderneta', issuer: 'MS', edition: '1ª', year: 2026,
        page: 7, section: 'vacinas', documentId: 'cad', sourceUrl: 'https://x.gov.br/a.pdf', manifestVersion: '2026.10.1',
      },
    });
    assert.equal(mapped.titulo, 'Caderneta');
    assert.equal(mapped.emissor, 'MS');
    assert.equal(mapped.pagina, 7);
    assert.equal(mapped.url, 'https://x.gov.br/a.pdf');
    assert.equal(mapped.versao_manifesto, '2026.10.1');
    assert.equal(mapped.relevancia, 0.8123);
  });

  test('citação segue a ordem dos trechos, sem score e com trecho curto', () => {
    const long = 'palavra '.repeat(80);
    const [first, second] = buildCitations([chunk(), chunk({ trecho: long, pagina: null, secao: 'vacinas' })]);
    assert.equal(first.numero, 1);
    assert.equal(second.numero, 2);
    assert.equal('relevancia' in first, false, 'score técnico não vai para o usuário');
    assert.equal(first.titulo, 'Caderneta brasileira da gestante');
    assert.equal(first.pagina, 12);
    assert.equal(second.pagina, null, 'sem página, não inventa página');
    assert.equal(second.secao, 'vacinas');
    assert.ok(second.trecho.length <= MAX_SNIPPET_CHARS + 1);
    assert.ok(second.trecho.endsWith('…'));
  });

  test('corta o trecho no fim de uma palavra', () => {
    assert.equal(shortSnippet('um dois tres quatro', 12), 'um dois tres…');
    assert.equal(shortSnippet('  curto  '), 'curto');
  });

  test('só trecho com documento e página ou seção é rastreável', () => {
    assert.equal(isTraceable(chunk()), true);
    assert.equal(isTraceable(chunk({ pagina: null })), true, 'seção basta');
    assert.equal(isTraceable(chunk({ pagina: null, secao: '' })), false);
    assert.equal(isTraceable(chunk({ pagina: 0, secao: null })), false);
    assert.equal(isTraceable(chunk({ trecho: '   ' })), false);
    assert.equal(isTraceable(chunk({ documento_id: null, titulo: null, fonte: null })), false);
    assert.deepEqual(selectTraceableChunks([chunk(), chunk({ pagina: null, secao: null })]).length, 1);
  });

  test('só aceita link https da fonte', () => {
    assert.equal(buildCitations([chunk({ url: 'javascript:alert(1)' })])[0].url, null);
    assert.equal(buildCitations([chunk({ url: 'http://inseguro.gov.br/a.pdf' })])[0].url, null);
  });
});

// ------------------------------------------------------------ controller
let retrieved = [];
const generationCalls = [];
const auditEvents = [];
const mocks = {
  '../services/ragRetrievalService': {
    RagRetrievalError: class RagRetrievalError extends Error {},
    retrieveChunks: async () => retrieved,
  },
  '../services/generationService': {
    GEMINI_MODEL: 'modelo-teste',
    RAG_CHAT_PROMPT_VERSION: 'rag-chat-v2-citacoes',
    generateAnswer: async (query, trechos) => {
      generationCalls.push({ query, trechos });
      return 'Procure a maternidade se houver sangramento [1].';
    },
  },
  '../services/vectorStoreService': {},
  '../services/agents/clinicalGraph': { runClinicalAgentGraph: async () => ({}) },
  '../services/clinicalDataService': { decryptPregnantDetails: () => ({}) },
  '../backend': { query: async () => ({ rows: [] }) },
  '../services/auditService': { audit: (req, event) => auditEvents.push(event) },
  '../utils/logger': { error() {}, warn() {}, info() {} },
};

const originalLoad = Module._load;
Module._load = function (request) {
  if (Object.prototype.hasOwnProperty.call(mocks, request)) return mocks[request];
  return originalLoad.apply(this, arguments);
};
const { askClinicalChat } = require('../controllers/ragController');
Module._load = originalLoad;

async function ask(query = 'Quais sinais de alarme na gestação?') {
  const res = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  await askClinicalChat({ body: { query }, user: { id: 1, role: 'gestante' } }, res);
  return res;
}

test.describe('Chat com citações (POST /api/internal/rag/chat)', () => {
  test.beforeEach(() => {
    retrieved = [];
    generationCalls.length = 0;
    auditEvents.length = 0;
  });

  test('as citações são exatamente os trechos enviados ao modelo', async () => {
    retrieved = [chunk(), chunk({ documento_id: 'manual-alto-risco', titulo: 'Manual de alto risco', pagina: 40 })];
    const { statusCode, body } = await ask();
    assert.equal(statusCode, 200);
    assert.equal(body.sem_fonte, false);
    assert.equal(generationCalls.length, 1);
    assert.deepEqual(
      body.citacoes.map((c) => [c.numero, c.documento_id, c.pagina]),
      generationCalls[0].trechos.map((t, i) => [i + 1, t.documento_id, t.pagina])
    );
    assert.equal(body.fontes.length, 2, 'campo antigo continua para compatibilidade');
  });

  test('trecho sem localização não vai ao modelo nem vira citação', async () => {
    retrieved = [chunk({ pagina: null, secao: null }), chunk({ documento_id: 'ok', pagina: 3 })];
    const { body } = await ask();
    assert.deepEqual(generationCalls[0].trechos.map((t) => t.documento_id), ['ok']);
    assert.deepEqual(body.citacoes.map((c) => c.documento_id), ['ok']);
    assert.equal(auditEvents[0].detail.discarded_untraceable, 1);
  });

  test('sem fonte rastreável, não gera resposta e devolve a orientação padrão', async () => {
    retrieved = [chunk({ pagina: null, secao: null })];
    const { statusCode, body } = await ask();
    assert.equal(statusCode, 200);
    assert.equal(generationCalls.length, 0, 'o modelo não é chamado');
    assert.equal(body.sem_fonte, true);
    assert.equal(body.resposta, 'Não encontrei isso nas fontes aprovadas. Converse com seu médico.');
    assert.deepEqual(body.citacoes, []);

    retrieved = [];
    const empty = await ask();
    assert.equal(empty.body.sem_fonte, true);
    assert.equal(generationCalls.length, 0);
  });

  test('auditoria registra documentos, versão do manifesto, modelo e prompt, sem o trecho', async () => {
    retrieved = [chunk()];
    await ask();
    const { detail } = auditEvents[0];
    assert.deepEqual(detail.citations, [{ documento_id: 'caderneta-gestante-ms-2026', pagina: 12, secao: 'sinais de alerta' }]);
    assert.deepEqual(detail.manifest_versions, ['2026.10.1']);
    assert.equal(detail.model, 'modelo-teste');
    assert.equal(detail.prompt_version, 'rag-chat-v2-citacoes');
    assert.doesNotMatch(JSON.stringify(detail), /sangramento vaginal/);
  });
});
