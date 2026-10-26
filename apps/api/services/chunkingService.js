/**
 * chunkingService.js
 *
 * Responsável por dividir textos de manuais e diretrizes em chunks determinísticos
 * para indexação no RAG (E4-02.2).
 *
 * Princípios:
 * - Determinismo estrito: mesma entrada produz sempre os mesmos chunks e IDs.
 * - Rastreabilidade: preserva documentId, title, year, page e section.
 * - Fronteira rígida de seção: chunks nunca misturam seções clínicas distintas.
 */

const DEFAULT_CHUNK_SIZE = Number(process.env.RAG_CHUNK_SIZE || 900);
const DEFAULT_CHUNK_OVERLAP = Number(process.env.RAG_CHUNK_OVERLAP || 150);

const SECTION_PATTERNS = [
  /^(CAP[IÍ]TULO|SE[CÇ][AÃ]O|PARTE)\s+\d+[^:\n]*[:\.\-]?\s*.*/i,
  /^\d+(\.\d+)*\s+[A-ZÁÉÍÓÚÂÊÔÃÕÇ][\w\s\-\.,]{3,}/,
];

function normalizeWhitespace(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function slugify(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function buildChunkId(documentId, pageNumber, indexInPage) {
  const cleanDocId = slugify(documentId);
  const page = pageNumber !== null && pageNumber !== undefined ? pageNumber : 0;
  const index = indexInPage !== null && indexInPage !== undefined ? indexInPage : 0;
  return `${cleanDocId}-p${page}-c${index}`;
}

function detectSectionHeader(text) {
  const firstLine = String(text || '').trim().split('\n')[0].trim();
  for (const pattern of SECTION_PATTERNS) {
    if (pattern.test(firstLine)) {
      return firstLine;
    }
  }
  return null;
}

function validateMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object') {
    throw new TypeError('metadata deve ser um objeto.');
  }
  if (!metadata.documentId || typeof metadata.documentId !== 'string') {
    throw new Error('metadata.documentId é obrigatório.');
  }
  if (!metadata.title || typeof metadata.title !== 'string') {
    throw new Error('metadata.title é obrigatório.');
  }
  if (metadata.year === undefined || metadata.year === null || typeof metadata.year !== 'number') {
    throw new Error('metadata.year é obrigatório e deve ser numérico.');
  }
}

/**
 * Converte input textual bruto ou array de páginas estruturadas em lista canônica de páginas.
 */
function parsePagesInput(input, fallbackPage = 1) {
  if (Array.isArray(input)) {
    return input.map((item, idx) => ({
      pageNumber: item.pageNumber !== undefined ? item.pageNumber : fallbackPage + idx,
      text: normalizeWhitespace(item.text),
      sections: item.sections || [],
    }));
  }

  const rawText = String(input || '');
  const pageDelimiterPattern = /--- Página\s+(\d+)\s+---/gi;

  if (!pageDelimiterPattern.test(rawText)) {
    return [
      {
        pageNumber: fallbackPage,
        text: normalizeWhitespace(rawText),
        sections: [],
      },
    ];
  }

  pageDelimiterPattern.lastIndex = 0;
  const parts = rawText.split(/--- Página\s+\d+\s+---/i);
  const matches = [...rawText.matchAll(/--- Página\s+(\d+)\s+---/gi)];

  const pages = [];
  for (let i = 0; i < matches.length; i += 1) {
    const pageNumber = Number(matches[i][1]);
    const pageText = normalizeWhitespace(parts[i + 1] || '');
    if (pageText) {
      pages.push({
        pageNumber,
        text: pageText,
        sections: [],
      });
    }
  }

  return pages;
}

function splitIntoParagraphs(text) {
  return normalizeWhitespace(text)
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

/**
 * Cria chunks determinísticos preservando página, seção, título e ano.
 */
function createChunks(input, metadata = {}, options = {}) {
  validateMetadata(metadata);

  const pages = parsePagesInput(input, metadata.page || 1);
  if (pages.length === 0 || pages.every((p) => !p.text)) {
    return [];
  }

  const chunkSize = Number(options.chunkSize || DEFAULT_CHUNK_SIZE);
  const chunkOverlap = Number(options.chunkOverlap || DEFAULT_CHUNK_OVERLAP);

  if (chunkOverlap >= chunkSize) {
    throw new Error('chunkOverlap deve ser menor que chunkSize.');
  }

  const documentId = slugify(metadata.documentId);
  let activeSection = metadata.section || 'Geral';

  const rawChunks = [];
  let currentChunkText = '';
  let currentChunkPage = pages[0].pageNumber;
  let currentChunkSection = activeSection;
  let previousChunkInSameSection = '';

  for (const page of pages) {
    const paragraphs = splitIntoParagraphs(page.text);

    for (const paragraph of paragraphs) {
      const detectedHeader = detectSectionHeader(paragraph);

      // Se detectou novo cabeçalho de seção estrutural
      if (detectedHeader && detectedHeader !== activeSection) {
        // Encerra o chunk corrente imediatamente na fronteira de seção
        if (currentChunkText) {
          rawChunks.push({
            text: currentChunkText,
            page: currentChunkPage,
            section: currentChunkSection,
          });
          currentChunkText = '';
        }

        activeSection = detectedHeader;
        currentChunkSection = activeSection;
        currentChunkPage = page.pageNumber;
        previousChunkInSameSection = ''; // Não carrega overlap entre seções distintas
      }

      const candidate = currentChunkText
        ? `${currentChunkText}\n\n${paragraph}`
        : paragraph;

      if (candidate.length <= chunkSize) {
        currentChunkText = candidate;
        currentChunkPage = page.pageNumber;
        continue;
      }

      // Ultrapassou chunkSize: fecha chunk atual e aplica overlap dentro da mesma seção
      if (currentChunkText) {
        rawChunks.push({
          text: currentChunkText,
          page: currentChunkPage,
          section: currentChunkSection,
        });
        previousChunkInSameSection = currentChunkText;
      }

      const overlapText = previousChunkInSameSection
        ? previousChunkInSameSection.slice(Math.max(0, previousChunkInSameSection.length - chunkOverlap))
        : '';

      currentChunkText = overlapText
        ? `${overlapText}\n\n${paragraph}`
        : paragraph;
      currentChunkPage = page.pageNumber;
      currentChunkSection = activeSection;
    }
  }

  if (currentChunkText) {
    rawChunks.push({
      text: currentChunkText,
      page: currentChunkPage,
      section: currentChunkSection,
    });
  }

  // Atribui IDs determinísticos por página e empacota metadados finais
  const pageChunkCounters = new Map();
  const chunks = [];

  for (const raw of rawChunks) {
    const page = raw.page !== null && raw.page !== undefined ? raw.page : 0;
    const indexInPage = pageChunkCounters.get(page) || 0;
    pageChunkCounters.set(page, indexInPage + 1);

    const chunkId = buildChunkId(documentId, page, indexInPage);

    chunks.push({
      id: chunkId,
      text: normalizeWhitespace(raw.text),
      metadata: {
        source: metadata.source || metadata.title,
        documentId,
        title: metadata.title,
        year: metadata.year,
        edition: metadata.edition,
        documentType: metadata.documentType || 'manual',
        page,
        section: raw.section,
        chunkIndex: indexInPage,
      },
    });
  }

  return chunks;
}

module.exports = {
  buildChunkId,
  createChunks,
  detectSectionHeader,
  normalizeWhitespace,
  parsePagesInput,
  slugify,
  validateMetadata,
};
