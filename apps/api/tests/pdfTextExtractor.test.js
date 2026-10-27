const { test, before } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');

const {
  extractDocumentText,
  PdfExtractionError,
  normalizeText,
} = require('../services/pdfTextExtractor');
const { main: generateFixtures } = require('../../../scripts/generate_synthetic_rag_fixtures');

const FIXTURES_DIR = path.resolve(__dirname, 'fixtures', 'rag');

before(async () => {
  if (!fsSync.existsSync(path.join(FIXTURES_DIR, 'synthetic-guideline.pdf'))) {
    await generateFixtures();
  }
});

test('PdfExtractionError: possui propriedades name, code e details', () => {
  const err = new PdfExtractionError('Documento vazio', 'EMPTY_DOCUMENT', { details: 123 });
  assert.strictEqual(err.name, 'PdfExtractionError');
  assert.strictEqual(err.code, 'EMPTY_DOCUMENT');
  assert.strictEqual(err.details.details, 123);
  assert.ok(err instanceof Error);
});

test('normalizeText: des-hifeniza palavras no final de linha e normaliza quebras', () => {
  const raw = 'O desenvolvi-\r\nmento fetal e hiper-\ntensao arterial.';
  const normalized = normalizeText(raw);
  assert.ok(normalized.includes('desenvolvimento'));
  assert.ok(normalized.includes('hipertensao'));
  assert.ok(!normalized.includes('-\n'));
});

test('extractDocumentText: falha com CORRUPTED_DOCUMENT em buffer corrompido ou vazio', async () => {
  const corruptedPath = path.join(FIXTURES_DIR, 'synthetic-corrupted.pdf');

  await assert.rejects(
    async () => {
      await extractDocumentText({ file_path: corruptedPath, document_name: 'synthetic-corrupted.pdf' });
    },
    (err) => {
      assert.strictEqual(err.name, 'PdfExtractionError');
      assert.strictEqual(err.code, 'CORRUPTED_DOCUMENT');
      return true;
    }
  );

  await assert.rejects(
    async () => {
      await extractDocumentText({ document_name: 'empty-buffer.pdf' }, { buffer: Buffer.alloc(0) });
    },
    (err) => {
      assert.strictEqual(err.name, 'PdfExtractionError');
      assert.strictEqual(err.code, 'CORRUPTED_DOCUMENT');
      return true;
    }
  );
});

test('extractDocumentText: falha com EMPTY_DOCUMENT em PDF sem texto extraível', async () => {
  const emptyPath = path.join(FIXTURES_DIR, 'synthetic-empty.pdf');

  await assert.rejects(
    async () => {
      await extractDocumentText(
        { file_path: emptyPath, document_name: 'synthetic-empty.pdf' },
        { enableOcr: false }
      );
    },
    (err) => {
      assert.strictEqual(err.name, 'PdfExtractionError');
      assert.strictEqual(err.code, 'EMPTY_DOCUMENT');
      return true;
    }
  );
});

test('extractDocumentText: falha com UNREADABLE_DOCUMENT quando texto for insuficiente e OCR desligado', async () => {
  const scannedPath = path.join(FIXTURES_DIR, 'synthetic-scanned.pdf');

  await assert.rejects(
    async () => {
      await extractDocumentText(
        { file_path: scannedPath, document_name: 'synthetic-scanned.pdf' },
        { enableOcr: false }
      );
    },
    (err) => {
      assert.strictEqual(err.name, 'PdfExtractionError');
      assert.strictEqual(err.code, 'UNREADABLE_DOCUMENT');
      return true;
    }
  );
});

test('extractDocumentText: fallback para OCR executa e retorna method ocr quando texto nativo for nulo', async () => {
  const scannedPath = path.join(FIXTURES_DIR, 'synthetic-scanned.pdf');
  let Tesseract;
  try {
    Tesseract = require('tesseract.js');
  } catch (err) {
    return; // Se tesseract não estiver instalado no ambiente
  }

  const originalRecognize = Tesseract.recognize;
  Tesseract.recognize = async () => ({
    data: {
      text: 'DIRETRIZ CLINICA RECONHECIDA VIA OCR SINTETICO COM SUCESSO PARA TESTES',
      confidence: 95.5,
    },
  });

  try {
    const result = await extractDocumentText(
      { file_path: scannedPath, document_name: 'synthetic-scanned.pdf' },
      { enableOcr: true }
    );
    assert.strictEqual(result.method, 'ocr');
    assert.ok(result.text.includes('RECONHECIDA VIA OCR'));
    assert.strictEqual(result.confidence, 95.5);
  } finally {
    Tesseract.recognize = originalRecognize;
  }
});

test('extractDocumentText: extrai PDF sintético com páginas estruturadas, seções e des-hifenização', async () => {
  const guidelinePath = path.join(FIXTURES_DIR, 'synthetic-guideline.pdf');
  const result = await extractDocumentText({
    file_path: guidelinePath,
    document_name: 'synthetic-guideline.pdf',
  });

  assert.ok(result.text.length > 100);
  assert.ok(Array.isArray(result.pages));
  assert.strictEqual(result.pages.length, 3);

  // Validação página 1
  assert.strictEqual(result.pages[0].pageNumber, 1);
  assert.ok(result.pages[0].text.includes('desenvolvimento fetal'));
  assert.ok(result.pages[0].sections.length > 0);
  assert.ok(result.pages[0].sections[0].includes('CAPITULO 1'));

  // Validação página 2
  assert.strictEqual(result.pages[1].pageNumber, 2);
  assert.ok(result.pages[1].text.includes('hipertensao arterial'));
  assert.ok(result.pages[1].sections.some((s) => s.includes('SECAO 1.1')));

  // Validação página 3
  assert.strictEqual(result.pages[2].pageNumber, 3);
  assert.ok(result.pages[2].text.includes('diabetes mellitus gestacional'));
  assert.ok(result.pages[2].sections.some((s) => s.includes('CAPITULO 2')));
});
