/**
 * generate_synthetic_rag_fixtures.js
 *
 * Gera fixtures sintéticas de PDFs para os testes unitários e de integração
 * da extração e chunking do RAG (E4-02.2).
 *
 * NENHUM DADO REAL DE PACIENTE É UTILIZADO.
 */

const fs = require('fs');
const path = require('path');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

const TARGET_DIR = path.resolve(__dirname, '..', 'apps', 'api', 'tests', 'fixtures', 'rag');

async function createSyntheticGuidelinePdf() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);

  // Página 1: Capítulo 1
  const page1 = doc.addPage([595, 842]); // A4
  page1.drawText('CAPITULO 1: INTRODUCAO E DIRETRIZES DE PRE-NATAL', {
    x: 50,
    y: 780,
    size: 14,
    font: boldFont,
    color: rgb(0, 0, 0),
  });
  page1.drawText(
    'O acompanhamento pre-natal regular e essencial para assegurar uma gestacao saudavel. ' +
    'As consultas devem ocorrer periodicamente para monitorar o desenvolvi-\nmento fetal ' +
    'e a saude da gestante. O cuidado precoce previne desfechos adversos e reduz mortalidade.',
    {
      x: 50,
      y: 740,
      size: 11,
      font,
      lineHeight: 16,
      maxWidth: 495,
      color: rgb(0.1, 0.1, 0.1),
    }
  );

  // Página 2: Seção 1.1 (Continuação do Capítulo 1)
  const page2 = doc.addPage([595, 842]);
  page2.drawText('SECAO 1.1: SINAIS DE ALERTA E HIPERTENSAO', {
    x: 50,
    y: 780,
    size: 13,
    font: boldFont,
    color: rgb(0, 0, 0),
  });
  page2.drawText(
    'A identificacao precoce de sinais de alerta inclui cefaleia persistente e escotomas. ' +
    'A presenca de hiper-\ntensao arterial sistemica exige vigilância rigorosa para prevenir pré-eclampsia. ' +
    'A prescricao de acido acetilsalicilico em baixas doses pode ser indicada em pacientes de alto risco.',
    {
      x: 50,
      y: 740,
      size: 11,
      font,
      lineHeight: 16,
      maxWidth: 495,
      color: rgb(0.1, 0.1, 0.1),
    }
  );

  // Página 3: Capítulo 2
  const page3 = doc.addPage([595, 842]);
  page3.drawText('CAPITULO 2: RASTREAMENTO DO DIABETES GESTACIONAL', {
    x: 50,
    y: 780,
    size: 14,
    font: boldFont,
    color: rgb(0, 0, 0),
  });
  page3.drawText(
    'O diabetes mellitus gestacional deve ser rastreado precocemente na primeira consulta de pre-natal. ' +
    'A glicemia de jejum inicial permite identificar alteracoes metabolicas previas ou diagnosticar DMG. ' +
    'Entre 24 e 28 semanas de gestacao, realiza-se o teste oral de tolerancia a glicose com sobrecarga de 75 gramas.',
    {
      x: 50,
      y: 740,
      size: 11,
      font,
      lineHeight: 16,
      maxWidth: 495,
      color: rgb(0.1, 0.1, 0.1),
    }
  );

  return doc.save();
}

async function createSyntheticEmptyPdf() {
  const doc = await PDFDocument.create();
  doc.addPage([595, 842]); // Página sem texto
  return doc.save();
}

async function createSyntheticScannedPdf() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);

  // Cria uma imagem minimalista 1x1 PNG válida em base64
  const tinyPngBase64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const pngBytes = Buffer.from(tinyPngBase64, 'base64');
  const pngImage = await doc.embedPng(pngBytes);

  page.drawImage(pngImage, {
    x: 100,
    y: 500,
    width: 200,
    height: 200,
  });

  return doc.save();
}

function createSyntheticCorruptedPdf() {
  return Buffer.from('NOT_A_VALID_PDF_HEADER_JUST_CORRUPTED_BYTES_12345');
}

async function main() {
  if (!fs.existsSync(TARGET_DIR)) {
    fs.mkdirSync(TARGET_DIR, { recursive: true });
  }

  const guidelineBytes = await createSyntheticGuidelinePdf();
  fs.writeFileSync(path.join(TARGET_DIR, 'synthetic-guideline.pdf'), guidelineBytes);

  const emptyBytes = await createSyntheticEmptyPdf();
  fs.writeFileSync(path.join(TARGET_DIR, 'synthetic-empty.pdf'), emptyBytes);

  const scannedBytes = await createSyntheticScannedPdf();
  fs.writeFileSync(path.join(TARGET_DIR, 'synthetic-scanned.pdf'), scannedBytes);

  const corruptedBytes = createSyntheticCorruptedPdf();
  fs.writeFileSync(path.join(TARGET_DIR, 'synthetic-corrupted.pdf'), corruptedBytes);

  console.log(`Fixtures sintéticas geradas com sucesso em: ${TARGET_DIR}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Erro ao gerar fixtures sintéticas:', err);
    process.exit(1);
  });
}

module.exports = {
  main,
  createSyntheticGuidelinePdf,
  createSyntheticEmptyPdf,
  createSyntheticScannedPdf,
  createSyntheticCorruptedPdf,
  TARGET_DIR,
};
