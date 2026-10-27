const generationService = require('../generationService');

const FETAL_FILTERS = {
  $or: [
    {
      documentId: {
        $in: [
          'manual-gestacao-alto-risco-ms-2022',
          'caderneta-gestante-ms-2026',
        ],
      },
    },
    { section: { $in: ['ultrassonografia', 'crescimento fetal', 'doppler', 'altura uterina'] } },
  ],
};

async function analyzeFetal({
  query,
  retrieveChunks,
  topK = 5,
}) {
  const sources = retrieveChunks
    ? await retrieveChunks(query, topK, FETAL_FILTERS)
    : [];
  const analysis = await generationService.generateAnswer(query, sources);

  return {
    active: true,
    analysis,
    sources,
  };
}

module.exports = {
  FETAL_FILTERS,
  analyzeFetal,
};
