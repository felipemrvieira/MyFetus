const generationService = require('../generationService');

const MATERNAL_FILTERS = {
  $or: [
    {
      documentId: {
        $in: [
          'caderneta-gestante-ms-2026',
          'manual-gestacao-alto-risco-ms-2022',
          'caderno32-prenatal-baixo-risco-ms-2012',
          'febrasgo-predicao-prevencao-pre-eclampsia-2023',
        ],
      },
    },
    { section: { $in: ['vacinas', 'nutrição', 'diabetes', 'pré-eclâmpsia'] } },
  ],
};

async function analyzeMaternal({
  query,
  patientContext,
  retrieveChunks,
  topK = 5,
}) {
  const sources = retrieveChunks
    ? await retrieveChunks(query, topK, MATERNAL_FILTERS)
    : [];
  const analysis = await generationService.generateMaternalAgentAnalysis(
    query,
    sources,
    patientContext
  );

  return {
    active: true,
    analysis,
    sources,
  };
}

module.exports = {
  MATERNAL_FILTERS,
  analyzeMaternal,
};
