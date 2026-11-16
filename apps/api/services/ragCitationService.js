/**
 * Citações das respostas do chat (E4-04, #130).
 *
 * Cada citação nasce de um trecho que foi realmente enviado ao modelo, na mesma
 * ordem e com o mesmo número usado no contexto ([1], [2]...). Só entram trechos
 * rastreáveis: com texto, documento do manifesto e página ou seção. Sem nenhum
 * trecho rastreável, o chat não gera resposta e devolve a orientação padrão.
 *
 * O score técnico (relevância) não vai para a citação, e o trecho exibido é
 * curto, para não reproduzir o documento.
 *
 * As perguntas 1 a 7 ao P.O. na #130 seguem sem resposta; estes padrões seguem
 * as sugestões registradas lá e ficam em constantes para ajuste fácil.
 */

const MAX_SNIPPET_CHARS = 280;

function cleanText(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

// Corta no fim de uma palavra e marca o corte com reticências.
function shortSnippet(text, maxChars = MAX_SNIPPET_CHARS) {
  const clean = cleanText(text);
  if (clean.length <= maxChars) return clean;
  const cut = clean.slice(0, maxChars);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > maxChars * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[\s,;:.-]+$/, '')}…`;
}

function hasLocation(chunk) {
  const page = Number(chunk.pagina);
  return (Number.isInteger(page) && page > 0) || Boolean(cleanText(chunk.secao));
}

// Rastreável: dá para dizer de qual documento e de onde dele o trecho veio.
function isTraceable(chunk) {
  return Boolean(
    chunk
    && cleanText(chunk.trecho)
    && (chunk.documento_id || chunk.titulo || chunk.fonte)
    && hasLocation(chunk)
  );
}

function selectTraceableChunks(chunks = []) {
  return (Array.isArray(chunks) ? chunks : []).filter(isTraceable);
}

function safeUrl(url) {
  return typeof url === 'string' && /^https:\/\//i.test(url) ? url : null;
}

function buildCitation(chunk, index, options = {}) {
  const page = Number(chunk.pagina);
  return {
    numero: index + 1,
    documento_id: chunk.documento_id || null,
    titulo: chunk.titulo || chunk.fonte || 'Fonte aprovada',
    emissor: chunk.emissor || null,
    edicao: chunk.edicao || null,
    ano: chunk.ano ?? null,
    pagina: Number.isInteger(page) && page > 0 ? page : null,
    secao: cleanText(chunk.secao) || null,
    trecho: shortSnippet(chunk.trecho, options.maxSnippetChars),
    url: safeUrl(chunk.url),
    versao_manifesto: chunk.versao_manifesto || null,
  };
}

/** Citações na mesma ordem dos trechos enviados ao modelo. */
function buildCitations(chunks = [], options = {}) {
  return chunks.map((chunk, index) => buildCitation(chunk, index, options));
}

function manifestVersions(citations = []) {
  return [...new Set(citations.map((citation) => citation.versao_manifesto).filter(Boolean))];
}

module.exports = {
  MAX_SNIPPET_CHARS,
  buildCitations,
  isTraceable,
  manifestVersions,
  selectTraceableChunks,
  shortSnippet,
};
