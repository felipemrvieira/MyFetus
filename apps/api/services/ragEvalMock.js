/**
 * Modo simulado do eval set (E4-06.2): busca e geração determinísticas, sem
 * rede, para a CI e para testar o executor. Os trechos são sintéticos e não
 * representam o conteúdo dos manuais; servem só para exercitar o caminho.
 *
 * A busca simulada responde por palavra-chave da pergunta, nunca pela
 * categoria do eval set, para não "colar" do rótulo.
 */
const MOCK_LIBRARY = Object.freeze([
  { terms: ['sangramento', 'sangue', 'dor de cabeça', 'visão', 'convuls', 'mexer', 'movimento'], chunk: {
    documento_id: 'caderneta-gestante-ms-2026', titulo: 'Caderneta brasileira da gestante (simulado)',
    pagina: 12, secao: 'sinais de alerta', trecho: 'Trecho sintético sobre sinais de alerta na gestação.',
  } },
  { terms: ['pressão', 'pressao', 'inchaço', 'inchaco'], chunk: {
    documento_id: 'manual-alto-risco-ms-2022', titulo: 'Manual de gestação de alto risco (simulado)',
    pagina: 40, secao: 'síndromes hipertensivas', trecho: 'Trecho sintético sobre pressão arterial na gestação.',
  } },
  { terms: ['vacina', 'gripe', 'dtpa', 'hepatite'], chunk: {
    documento_id: 'caderneta-gestante-ms-2026', titulo: 'Caderneta brasileira da gestante (simulado)',
    pagina: 30, secao: 'vacinas', trecho: 'Trecho sintético sobre vacinação na gestação.',
  } },
  { terms: ['glicemia', 'açúcar', 'acucar', 'diabetes', 'alimenta', 'comer', 'enjoo', 'exercício', 'exercicio', 'pré-natal', 'pre-natal', 'consulta'], chunk: {
    documento_id: 'caderno-atencao-basica-32', titulo: 'Caderno de atenção básica 32 (simulado)',
    pagina: 55, secao: 'cuidados no pré-natal', trecho: 'Trecho sintético sobre cuidados de rotina no pré-natal.',
  } },
]);

function normalize(text) {
  return String(text || '').toLowerCase();
}

function mockRetrieveChunks(query) {
  const text = normalize(query);
  return MOCK_LIBRARY
    .filter((entry) => entry.terms.some((term) => text.includes(term)))
    .map((entry, index) => ({
      ...entry.chunk,
      fonte: entry.chunk.titulo,
      relevancia: Number((0.9 - index * 0.05).toFixed(2)),
      url: null,
      versao_manifesto: 'simulado',
    }));
}

function createMockGenerator(disclaimer) {
  return async function mockGenerateAnswerDetailed(query, trechos) {
    const refs = trechos.map((_, index) => `[${index + 1}]`).join(' ');
    const words = String(query).split(/\s+/).length;
    return {
      text: `Resposta simulada com base nas fontes ${refs}.\n\n${disclaimer}`,
      usage: { prompt_tokens: 120 + words * 2, response_tokens: 40, total_tokens: 160 + words * 2 },
    };
  };
}

module.exports = {
  MOCK_LIBRARY,
  createMockGenerator,
  mockRetrieveChunks,
};
