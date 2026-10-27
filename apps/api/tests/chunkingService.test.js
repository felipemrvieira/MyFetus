const { test } = require('node:test');
const assert = require('node:assert');
const {
  createChunks,
  normalizeWhitespace,
  slugify,
  buildChunkId,
} = require('../services/chunkingService');

test('normalizeWhitespace: normaliza quebras e múltiplos espaços', () => {
  const normalized = normalizeWhitespace('Texto   com    espaços\r\n\r\n\r\nnova linha.');
  assert.strictEqual(normalized, 'Texto com espaços\n\nnova linha.');
});

test('slugify: normaliza acentos e pontuações para identificador estável', () => {
  const slug = slugify('FEBRASGO — Predição e prevenção da pré-eclâmpsia 2023');
  assert.strictEqual(slug, 'febrasgo-predicao-e-prevencao-da-pre-eclampsia-2023');
});

test('buildChunkId: formata ID canônico ${documentId}-p${page}-c${indexInPage}', () => {
  const id1 = buildChunkId('caderneta-gestante-ms-2026', 15, 0);
  assert.strictEqual(id1, 'caderneta-gestante-ms-2026-p15-c0');

  const id2 = buildChunkId('caderneta-gestante-ms-2026', null, 2);
  assert.strictEqual(id2, 'caderneta-gestante-ms-2026-p0-c2');
});

test('createChunks: falha se metadados obrigatórios estiverem ausentes', () => {
  assert.throws(
    () => {
      createChunks('Texto qualquer', { title: 'Título', year: 2026 });
    },
    /documentId é obrigatório/
  );

  assert.throws(
    () => {
      createChunks('Texto qualquer', { documentId: 'doc-1', year: 2026 });
    },
    /title é obrigatório/
  );

  assert.throws(
    () => {
      createChunks('Texto qualquer', { documentId: 'doc-1', title: 'Título' });
    },
    /year é obrigatório/
  );
});

test('createChunks: determinismo estrito (mesma entrada gera mesmos chunks e IDs byte a byte)', () => {
  const sample = `
--- Página 1 ---
CAPÍTULO 1: PRE-NATAL
O acompanhamento pré-natal é fundamental para a saúde da gestante e do bebê.
Consultas regulares devem ser realizadas durante toda a gravidez.

--- Página 2 ---
Exames de rotina incluem hemograma, glicemia de jejum e sorologias para infecções.
`;

  const meta = {
    documentId: 'manual-baixo-risco-ms-2012',
    title: 'Manual de Pré-natal de Baixo Risco',
    year: 2012,
    source: 'Ministério da Saúde',
  };

  const run1 = createChunks(sample, meta, { chunkSize: 120, chunkOverlap: 20 });
  const run2 = createChunks(sample, meta, { chunkSize: 120, chunkOverlap: 20 });

  assert.ok(run1.length > 0);
  assert.deepStrictEqual(run1, run2, 'Duas execuções com a mesma entrada devem ser estritamente idênticas');

  // Garante que nenhum campo volátil como indexedAt foi inserido no chunk
  for (const chunk of run1) {
    assert.strictEqual(chunk.metadata.indexedAt, undefined);
    assert.ok(chunk.id.match(/^manual-baixo-risco-ms-2012-p\d+-c\d+$/));
  }
});

test('createChunks: preserva página, seção, título e ano nos metadados', () => {
  const sample = `
--- Página 1 ---
CAPÍTULO 1: PRE-NATAL
O acompanhamento pré-natal é fundamental para a saúde da gestante.
`;

  const meta = {
    documentId: 'manual-baixo-risco-ms-2012',
    title: 'Manual de Pré-natal de Baixo Risco',
    year: 2012,
    section: 'Geral',
  };

  const chunks = createChunks(sample, meta);
  assert.strictEqual(chunks.length, 1);
  assert.strictEqual(chunks[0].metadata.documentId, 'manual-baixo-risco-ms-2012');
  assert.strictEqual(chunks[0].metadata.title, 'Manual de Pré-natal de Baixo Risco');
  assert.strictEqual(chunks[0].metadata.year, 2012);
  assert.strictEqual(chunks[0].metadata.page, 1);
  assert.strictEqual(chunks[0].metadata.section, 'CAPÍTULO 1: PRE-NATAL');
  assert.strictEqual(chunks[0].id, 'manual-baixo-risco-ms-2012-p1-c0');
});

test('createChunks: quebra rígida de seção sem contaminação por overlap', () => {
  const sample = `
--- Página 1 ---
CAPÍTULO 1: HIPERTENSÃO
A pré-eclâmpsia pode se manifestar após 20 semanas de gestação com pressão elevada.

CAPÍTULO 2: DIABETES
O diabetes gestacional exige monitoramento glicêmico e acompanhamento nutricional.
`;

  const meta = {
    documentId: 'manual-alto-risco-ms-2022',
    title: 'Manual de Gestação de Alto Risco',
    year: 2022,
  };

  const chunks = createChunks(sample, meta, { chunkSize: 300, chunkOverlap: 50 });

  // Deve gerar pelo menos 2 chunks separados pelas duas seções
  assert.ok(chunks.length >= 2);

  const chunkCap1 = chunks.find((c) => c.metadata.section.includes('HIPERTENSÃO'));
  const chunkCap2 = chunks.find((c) => c.metadata.section.includes('DIABETES'));

  assert.ok(chunkCap1, 'Deve existir chunk da seção de hipertensão');
  assert.ok(chunkCap2, 'Deve existir chunk da seção de diabetes');

  // O chunk do capítulo 2 não deve conter trechos do capítulo 1 por overlap
  assert.ok(!chunkCap2.text.includes('pré-eclâmpsia'), 'Overlap não pode cruzar fronteira de seções clínicas distintas');
});

test('createChunks: suporta entrada estruturada de pages (extraída de PDF)', () => {
  const pages = [
    {
      pageNumber: 1,
      text: 'CAPÍTULO 1: CONSULTAS\nAs consultas devem ser mensais até a vigésima oitava semana.',
      sections: ['CAPÍTULO 1: CONSULTAS'],
    },
    {
      pageNumber: 2,
      text: 'SEÇÃO 1.1: EXAMES\nExames laboratoriais e ultrassonografia devem ser agendados.',
      sections: ['SEÇÃO 1.1: EXAMES'],
    },
  ];

  const meta = {
    documentId: 'caderneta-gestante-ms-2026',
    title: 'Caderneta da Gestante',
    year: 2026,
  };

  const chunks = createChunks(pages, meta);
  assert.strictEqual(chunks.length, 2);
  assert.strictEqual(chunks[0].metadata.page, 1);
  assert.strictEqual(chunks[0].metadata.section, 'CAPÍTULO 1: CONSULTAS');
  assert.strictEqual(chunks[0].id, 'caderneta-gestante-ms-2026-p1-c0');

  assert.strictEqual(chunks[1].metadata.page, 2);
  assert.strictEqual(chunks[1].metadata.section, 'SEÇÃO 1.1: EXAMES');
  assert.strictEqual(chunks[1].id, 'caderneta-gestante-ms-2026-p2-c0');
});
