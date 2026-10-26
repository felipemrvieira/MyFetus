const fs = require('fs/promises');
const path = require('path');

const MIN_TEXT_LENGTH_FOR_OCR = Number(process.env.PDF_TEXT_MIN_LENGTH_FOR_OCR || 50);
const OCR_LANGUAGES = process.env.OCR_LANGUAGES || 'por+eng';
const OCR_SCALE = Number(process.env.PDF_OCR_SCALE || 2);

class PdfExtractionError extends Error {
  constructor(message, code = 'EXTRACTION_ERROR', details = {}) {
    super(message);
    this.name = 'PdfExtractionError';
    this.code = code;
    this.details = details;
  }
}

const SECTION_PATTERNS = [
  /^(CAP[IÍ]TULO|SE[CÇ][AÃ]O|PARTE)\s+\d+[^:\n]*[:\.\-]?\s*.*/i,
  /^\d+(\.\d+)*\s+[A-ZÁÉÍÓÚÂÊÔÃÕÇ][\w\s\-\.,]{3,}/,
];

function detectSections(text) {
  const lines = String(text || '').split('\n');
  const sections = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    for (const pattern of SECTION_PATTERNS) {
      if (pattern.test(trimmed)) {
        sections.push(trimmed);
        break;
      }
    }
  }
  return sections;
}

function normalizeText(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    // Des-hifenização de quebras de linha (ex: "desenvolvi-\nmento" -> "desenvolvimento")
    .replace(/([\p{L}\p{N}]+)-\s*\n\s*([\p{L}\p{N}]+)/gu, '$1$2')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function formatPdfJsItems(items) {
  if (!items || items.length === 0) return '';
  let text = '';
  let lastY = null;

  for (const item of items) {
    if (!item.str) continue;
    const currentY = item.transform ? item.transform[5] : null;

    if (lastY !== null && currentY !== null && Math.abs(currentY - lastY) > 4) {
      text += '\n';
    } else if (text.length > 0 && !text.endsWith('\n') && !text.endsWith(' ')) {
      text += ' ';
    }

    text += item.str;
    if (currentY !== null) {
      lastY = currentY;
    }
  }

  return text;
}

function isPdfDocument(document) {
  const extension = path.extname(document.file_path || document.document_name || '').toLowerCase();
  const documentType = String(document.document_type || '').toLowerCase();

  return extension === '.pdf' || documentType.includes('pdf');
}

async function loadPdfJs() {
  return import('pdfjs-dist/legacy/build/pdf.mjs');
}

async function loadPdf(buffer) {
  if (!buffer || buffer.length === 0) {
    throw new PdfExtractionError(
      'Buffer do documento PDF está vazio.',
      'CORRUPTED_DOCUMENT'
    );
  }

  const pdfjs = await loadPdfJs();

  try {
    return await pdfjs.getDocument({
      data: new Uint8Array(buffer),
      disableWorker: true,
      useSystemFonts: true,
    }).promise;
  } catch (err) {
    throw new PdfExtractionError(
      `Falha ao abrir PDF corrompido ou inválido: ${err.message}`,
      'CORRUPTED_DOCUMENT',
      { originalError: err.message }
    );
  }
}

async function extractTextWithPdfJs(buffer) {
  const pdf = await loadPdf(buffer);
  const pages = [];
  const textBlocks = [];
  let totalVisualOps = 0;

  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const ops = await page.getOperatorList();

      const pageOpsCount = ops.fnArray ? ops.fnArray.length : 0;
      totalVisualOps += pageOpsCount;

      const rawPageText = formatPdfJsItems(content.items);
      const normalizedPageText = normalizeText(rawPageText);
      const sections = detectSections(normalizedPageText);

      pages.push({
        pageNumber,
        text: normalizedPageText,
        sections,
      });

      if (normalizedPageText) {
        textBlocks.push(`--- Página ${pageNumber} ---\n${normalizedPageText}`);
      }
    }
  } finally {
    await pdf.destroy();
  }

  return {
    text: normalizeText(textBlocks.join('\n\n')),
    pages,
    numPages: pdf.numPages,
    totalVisualOps,
  };
}

async function renderPageToPng(page) {
  let createCanvas;

  try {
    ({ createCanvas } = require('@napi-rs/canvas'));
  } catch (err) {
    throw new Error('Dependência @napi-rs/canvas não encontrada para renderizar PDF antes do OCR.');
  }

  const viewport = page.getViewport({ scale: OCR_SCALE });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const context = canvas.getContext('2d');

  await page.render({
    canvasContext: context,
    viewport,
  }).promise;

  return canvas.toBuffer('image/png');
}

async function extractTextWithOcr(buffer) {
  let Tesseract;

  try {
    Tesseract = require('tesseract.js');
  } catch (err) {
    throw new Error('Dependência tesseract.js não encontrada para executar OCR.');
  }

  const pdf = await loadPdf(buffer);
  const pages = [];
  const textBlocks = [];

  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const image = await renderPageToPng(page);
      const result = await Tesseract.recognize(image, OCR_LANGUAGES);
      const pageText = normalizeText(result.data?.text);
      const sections = detectSections(pageText);

      pages.push({
        pageNumber,
        text: pageText,
        sections,
      });

      if (pageText) {
        textBlocks.push(`--- Página ${pageNumber} ---\n${pageText}`);
      }

      if (typeof result.data?.confidence === 'number') {
        pages.confidences = [...(pages.confidences || []), result.data.confidence];
      }
    }
  } finally {
    await pdf.destroy();
  }

  const confidences = pages.confidences || [];
  const confidence = confidences.length
    ? confidences.reduce((sum, value) => sum + value, 0) / confidences.length
    : null;

  return {
    text: normalizeText(textBlocks.join('\n\n')),
    pages,
    confidence,
    numPages: pdf.numPages,
  };
}

async function extractDocumentText(document, options = {}) {
  let buffer = options.buffer;

  if (!buffer && document.file_path) {
    try {
      buffer = await fs.readFile(document.file_path);
    } catch (err) {
      throw new PdfExtractionError(
        `Não foi possível ler o arquivo: ${err.message}`,
        'CORRUPTED_DOCUMENT',
        { originalError: err.message }
      );
    }
  }

  if (!buffer || buffer.length === 0) {
    throw new PdfExtractionError(
      'Buffer do documento está vazio ou não fornecido.',
      'CORRUPTED_DOCUMENT'
    );
  }

  if (!isPdfDocument(document)) {
    const rawText = normalizeText(buffer.toString('utf8'));
    if (!rawText) {
      throw new PdfExtractionError(
        'Documento de texto está vazio.',
        'EMPTY_DOCUMENT'
      );
    }
    return {
      text: rawText,
      pages: [{ pageNumber: 1, text: rawText, sections: detectSections(rawText) }],
      method: 'plain-text',
      confidence: null,
    };
  }

  const pdfResult = await extractTextWithPdfJs(buffer);

  if (pdfResult.numPages === 0) {
    throw new PdfExtractionError(
      'Documento PDF não possui páginas.',
      'EMPTY_DOCUMENT'
    );
  }

  const hasContent = pdfResult.totalVisualOps > 0 || pdfResult.text.length > 0;
  if (!hasContent) {
    throw new PdfExtractionError(
      'Documento PDF não contém texto extraível nem elementos visuais.',
      'EMPTY_DOCUMENT'
    );
  }

  const ocrEnabled = options.enableOcr !== false && process.env.ENABLE_DOCUMENT_OCR !== 'false';

  if (pdfResult.text.length >= MIN_TEXT_LENGTH_FOR_OCR) {
    return {
      text: pdfResult.text,
      pages: pdfResult.pages,
      method: 'pdfjs',
      confidence: null,
    };
  }

  // Se o texto for menor que o limite mínimo para OCR
  if (!ocrEnabled) {
    throw new PdfExtractionError(
      'Documento PDF possui texto insuficiente ou ilegível e OCR está desabilitado.',
      'UNREADABLE_DOCUMENT',
      { textLength: pdfResult.text.length, minRequired: MIN_TEXT_LENGTH_FOR_OCR }
    );
  }

  // Tenta OCR
  const ocrResult = await extractTextWithOcr(buffer);

  if (!ocrResult.text || ocrResult.text.trim().length === 0) {
    throw new PdfExtractionError(
      'Documento PDF ilegível: OCR não conseguiu extrair nenhum texto útil.',
      'UNREADABLE_DOCUMENT'
    );
  }

  return {
    text: ocrResult.text,
    pages: ocrResult.pages,
    method: 'ocr',
    confidence: ocrResult.confidence,
  };
}

module.exports = {
  PdfExtractionError,
  SECTION_PATTERNS,
  detectSections,
  extractDocumentText,
  extractTextWithPdfJs,
  extractTextWithOcr,
  isPdfDocument,
  normalizeText,
};
