const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  CSV_COLUMNS,
  indexGabarito,
  runEval,
  summarize,
  toCsv,
  toNdjson,
  validateDataset,
} = require('../services/ragEvalService');
const { createRagChatService } = require('../services/ragChatService');
const { mockRetrieveChunks } = require('../services/ragEvalMock');
const { SAFE_MESSAGES } = require('../services/agents/guardrailService');
const { main, parseArgs } = require('../scripts/ragEval');

const EXAMPLE = path.join(__dirname, '..', 'data', 'rag-eval', 'perguntas.exemplo.json');
const EXAMPLE_GABARITO = path.join(__dirname, '..', 'data', 'rag-eval', 'gabarito.exemplo.json');

function dataset(perguntas) {
  return { versao: 't1', sintetico: true, perguntas };
}

function question(id, categoria = 'comum', pergunta = `Pergunta sintética ${id}?`) {
  return { id, categoria, pergunta };
}

function traceableChunk(overrides = {}) {
  return {
    trecho: 'Trecho sintético.', fonte: 'Doc', titulo: 'Doc', documento_id: 'doc-1',
    pagina: 3, secao: 'geral', relevancia: 0.9, versao_manifesto: 'm1', ...overrides,
  };
}

test.describe('Eval set: validação do arquivo de perguntas', () => {
  test('o exemplo versionado é válido e só avisa da composição', () => {
    const { errors, warnings } = validateDataset(JSON.parse(fs.readFileSync(EXAMPLE, 'utf8')));
    assert.deepEqual(errors, []);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /30 comum, 10 fora_de_escopo, 10 alarme/);
  });

  test('50 perguntas na composição combinada não geram aviso', () => {
    const perguntas = [
      ...Array.from({ length: 30 }, (_, i) => question(`c${i}`, 'comum')),
      ...Array.from({ length: 10 }, (_, i) => question(`f${i}`, 'fora_de_escopo')),
      ...Array.from({ length: 10 }, (_, i) => question(`a${i}`, 'alarme')),
    ];
    assert.deepEqual(validateDataset(dataset(perguntas)).warnings, []);
  });

  test('recusa eval set não sintético, id repetido, categoria inválida e pergunta vazia', () => {
    const { errors } = validateDataset({
      versao: 't1',
      sintetico: false,
      perguntas: [question('x'), question('x'), { id: 'y', categoria: 'outra', pergunta: '' }],
    });
    assert.ok(errors.some((e) => /sintetico/.test(e)));
    assert.ok(errors.some((e) => /x: id repetido/.test(e)));
    assert.ok(errors.some((e) => /y: categoria inválida/.test(e)));
    assert.ok(errors.some((e) => /y: falta o texto/.test(e)));
  });

  test('gabarito dentro do arquivo de perguntas é recusado', () => {
    const { errors } = validateDataset(dataset([{ ...question('x'), resposta_esperada: 'vazou' }]));
    assert.ok(errors.some((e) => /gabarito \(resposta_esperada\) fica no arquivo separado/.test(e)));
  });

  test('pergunta com dado identificável é recusada', () => {
    const { errors } = validateDataset(dataset([question('x', 'comum', 'Meu exame de 12/10/2026 deu 95, é alto?')]));
    assert.ok(errors.some((e) => /dado pessoal ou identificável/.test(e)));
  });
});

test.describe('Eval set: execução', () => {
  test('separa resposta ok, sem fonte, falha de busca, falha de geração e bloqueio do guardrail', async () => {
    const outcomes = {
      ok: { resposta: `Resposta [1].\n\n${SAFE_MESSAGES.disclaimer}`, semFonte: false, citacoes: [{ numero: 1, documento_id: 'd', titulo: 'D', pagina: 2, secao: 's', trecho: 'longo' }], usage: { total_tokens: 50 }, timings: { retrieval_ms: 5, generation_ms: 7 }, model: 'm', promptVersion: 'p', manifestVersions: ['v1'] },
      semfonte: { resposta: SAFE_MESSAGES.no_source, semFonte: true, citacoes: [] },
      vazio: { resposta: '   ', semFonte: false, citacoes: [] },
      bloqueio: { resposta: SAFE_MESSAGES.urgent, blockedBy: 'urgent', citacoes: [] },
    };
    const answer = async (pergunta) => {
      if (pergunta.includes('busca')) throw Object.assign(new Error('x'), { stage: 'retrieval', code: 'VECTOR_STORE_UNAVAILABLE' });
      if (pergunta.includes('geracao')) throw Object.assign(new Error('x'), { stage: 'generation' });
      return outcomes[pergunta.split(' ')[0]];
    };
    let pauses = 0;
    const results = await runEval({
      dataset: dataset([
        question('q1', 'comum', 'ok?'), question('q2', 'comum', 'semfonte?'), question('q3', 'alarme', 'vazio?'),
        question('q4', 'alarme', 'bloqueio?'), question('q5', 'comum', 'erro de busca?'), question('q6', 'comum', 'erro de geracao?'),
      ].map((q) => ({ ...q, pergunta: q.pergunta.replace('?', ' ?') }))),
      answer,
      classify: () => ({ category: 'in_scope' }),
      disclaimer: SAFE_MESSAGES.disclaimer,
      pauseMs: 10,
      sleep: async () => { pauses += 1; },
    });
    assert.deepEqual(results.map((r) => r.status), [
      'ok', 'retrieval_failure', 'generation_failure', 'blocked_by_guardrail', 'retrieval_failure', 'generation_failure',
    ]);
    assert.equal(pauses, 5, 'pausa só entre perguntas');
    assert.equal(results[0].disclaimer_presente, true);
    assert.deepEqual(results[0].citacoes, [{ numero: 1, documento_id: 'd', titulo: 'D', pagina: 2, secao: 's' }], 'sem o trecho');
    assert.equal(results[0].tokens.total_tokens, 50);
    assert.equal(results[4].erro, 'VECTOR_STORE_UNAVAILABLE');
    assert.equal(results[0].guardrail_categoria, 'in_scope');
  });

  test('o pipeline do chat marca de onde veio o erro e não chama o modelo sem fonte', async () => {
    let generated = 0;
    const chat = createRagChatService({
      retrieveChunks: async (query) => (query.includes('nada') ? [traceableChunk({ pagina: null, secao: null })] : [traceableChunk()]),
      generateAnswerDetailed: async () => { generated += 1; return { text: 'ok [1]', usage: { total_tokens: 9 } }; },
      model: 'm', promptVersion: 'p',
    });
    const none = await chat.answer('nada aqui');
    assert.equal(none.semFonte, true);
    assert.equal(none.resposta, SAFE_MESSAGES.no_source);
    assert.equal(none.model, null);
    assert.equal(generated, 0);

    const ok = await chat.answer('vacinas');
    assert.equal(ok.semFonte, false);
    assert.equal(ok.citacoes[0].numero, 1);
    assert.deepEqual(ok.manifestVersions, ['m1']);
    assert.equal(generated, 1);

    const failing = createRagChatService({
      retrieveChunks: async () => { throw new Error('fora do ar'); },
      generateAnswerDetailed: async () => ({ text: '' }),
    });
    await assert.rejects(() => failing.answer('x'), (error) => error.stage === 'retrieval');
  });

  test('a busca simulada responde por palavra-chave, nunca pela categoria', () => {
    assert.ok(mockRetrieveChunks('vacina da gripe').length > 0);
    assert.deepEqual(mockRetrieveChunks('receita de bolo'), []);
  });

  test('resumo conta falha de recuperação só nas perguntas clínicas', () => {
    const summary = summarize([
      { categoria: 'comum', status: 'retrieval_failure', latencia_ms: 10, tokens: null },
      { categoria: 'alarme', status: 'ok', latencia_ms: 30, tokens: { total_tokens: 100 }, disclaimer_presente: false },
      { categoria: 'fora_de_escopo', status: 'retrieval_failure', latencia_ms: 20, tokens: { total_tokens: 20 } },
    ]);
    assert.equal(summary.total, 3);
    assert.equal(summary.por_status.retrieval_failure, 2);
    assert.equal(summary.falhas_de_recuperacao_clinicas, 1);
    assert.equal(summary.sem_disclaimer, 1);
    assert.equal(summary.tokens_total, 120);
    assert.deepEqual(summary.latencia_ms, { media: 20, p50: 20, p95: 30, max: 30 });
    assert.equal(summary.por_categoria.fora_de_escopo.retrieval_failure, 1);
  });
});

test.describe('Eval set: planilha', () => {
  test('abre no Excel em português e deixa a avaliação em branco para o P.O.', () => {
    const csv = toCsv([{
      id: 'q1', categoria: 'comum', pergunta: 'Tem "aspas"; e ponto e vírgula?', resposta: 'linha 1\nlinha 2',
      citacoes: [{ numero: 1, titulo: 'Caderneta', pagina: 12, secao: 'vacinas' }], status: 'ok',
      guardrail_categoria: 'in_scope', latencia_ms: 42, tokens: { total_tokens: 7 }, disclaimer_presente: true, erro: null,
    }], indexGabarito({ respostas: [{ id: 'q1', resposta_esperada: 'Esperada' }] }));
    assert.ok(csv.startsWith('﻿'), 'BOM para o Excel ler UTF-8');
    const [header, ...rest] = csv.slice(1).split('\r\n');
    assert.equal(header, CSV_COLUMNS.join(';'));
    const row = rest.join('\r\n').trimEnd();
    assert.ok(row.includes('"Tem ""aspas""; e ponto e vírgula?"'));
    assert.ok(row.includes('"linha 1\nlinha 2"'));
    assert.ok(row.includes('[1] Caderneta, p. 12, vacinas'));
    assert.ok(row.includes(';Esperada;'));
    assert.ok(row.endsWith(';sim;;;;'), 'avaliacao, comentario e avaliador em branco');
  });

  test('NDJSON tem uma linha por pergunta', () => {
    assert.equal(toNdjson([{ id: 'a' }, { id: 'b' }]).trim().split('\n').length, 2);
  });
});

test.describe('Eval set: comando npm run rag:eval', () => {
  const silent = () => {};

  test('modo simulado grava planilha, resultados e resumo com as versões', async () => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'rag-eval-'));
    try {
      const code = await main(['--gabarito', EXAMPLE_GABARITO, '--saida', out], { log: silent });
      assert.equal(code, 0);
      const resumo = JSON.parse(fs.readFileSync(path.join(out, 'resumo.json'), 'utf8'));
      assert.equal(resumo.modo, 'mock');
      assert.equal(resumo.caminho, 'chat');
      assert.equal(resumo.eval_set.versao, 'exemplo-1');
      assert.match(resumo.eval_set.sha256, /^[0-9a-f]{64}$/);
      assert.equal(resumo.resumo.total, 6);
      assert.equal(fs.readFileSync(path.join(out, 'resultados.ndjson'), 'utf8').trim().split('\n').length, 6);
      assert.ok(fs.readFileSync(path.join(out, 'planilha.csv'), 'utf8').includes('Orientar a procurar a maternidade'));
    } finally {
      fs.rmSync(out, { recursive: true, force: true });
    }
  });

  test('o caminho multiagente também roda simulado', async () => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'rag-eval-'));
    try {
      assert.equal(await main(['--caminho', 'agents', '--saida', out], { log: silent }), 0);
      const resumo = JSON.parse(fs.readFileSync(path.join(out, 'resumo.json'), 'utf8'));
      assert.ok(resumo.resumo.por_status.blocked_by_guardrail > 0, 'alarme é bloqueado pelo guardrail');
    } finally {
      fs.rmSync(out, { recursive: true, force: true });
    }
  });

  test('modo real só roda com --confirmar-real e eval set inválido não roda', async () => {
    const out = path.join(os.tmpdir(), `rag-eval-nao-deve-existir-${Date.now()}`);
    assert.equal(await main(['--modo', 'real', '--saida', out], { log: silent }), 2);
    assert.equal(fs.existsSync(out), false);

    const bad = path.join(os.tmpdir(), `rag-eval-invalido-${Date.now()}.json`);
    fs.writeFileSync(bad, JSON.stringify({ versao: 'x', sintetico: false, perguntas: [] }));
    try {
      assert.equal(await main(['--perguntas', bad, '--saida', out], { log: silent }), 2);
      assert.equal(fs.existsSync(out), false);
    } finally {
      fs.rmSync(bad, { force: true });
    }
  });

  test('opções inválidas param com mensagem clara', () => {
    assert.throws(() => parseArgs(['--modo', 'producao']), /mock ou real/);
    assert.throws(() => parseArgs(['--top-k', '50']), /1 a 20/);
    assert.throws(() => parseArgs(['--saida']), /Falta o valor/);
    assert.throws(() => parseArgs(['--qualquer']), /Opção desconhecida/);
  });
});
