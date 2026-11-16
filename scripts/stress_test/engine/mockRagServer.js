/**
 * mockRagServer.js
 *
 * Provedor de mocks em memória determinístico para CI (Marco M2).
 * Simula as respostas do RAG (chat e busca) para os 6 edge cases
 * e cenários clínicos sem realizar chamadas de rede externas.
 */

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function getMockRagAnswer(query, options = {}) {
  const normalized = normalizeText(query);
  const scenarioId = options.scenario_id;
  const stage = options.estagio;

  // --- Despacho direto por cenário e estágio quando informado ---
  if (scenarioId === 'preeclampsia') {
    if (stage === 1) {
      return {
        status: 200,
        resposta: 'Na suspeita inicial de pré-eclâmpsia após 20 semanas, investiga-se com aferição seriada da pressão arterial e pesquisa de proteinúria.',
        resultados: [
          { fonte: 'FEBRASGO', trecho: 'Avaliação de pressão arterial e proteinúria na suspeita inicial.', relevancia: 0.88 },
          { fonte: 'ACOG', trecho: 'Monitorização da pressão arterial e proteinúria.', relevancia: 0.85 },
          { fonte: 'Ministério da Saúde', trecho: 'Rastreio de pré-eclâmpsia com pressão arterial e proteinúria.', relevancia: 0.82 },
        ],
      };
    }
    if (stage === 2) {
      return {
        status: 200,
        resposta: 'Na pré-eclâmpsia sem sinais de gravidade com hipertensão e proteinúria 1+, recomenda-se monitorização ambulatorial materno-fetal.',
        resultados: [
          { fonte: 'FEBRASGO', trecho: 'Conduta na hipertensão e proteinúria com monitorização materna e fetal periódica.', relevancia: 0.89 },
          { fonte: 'ACOG', trecho: 'Vigilância da hipertensão e proteinúria com monitorização.', relevancia: 0.86 },
          { fonte: 'Ministério da Saúde', trecho: 'Protocolo de hipertensão, proteinúria e monitorização na gestação.', relevancia: 0.84 },
        ],
      };
    }
    if (stage === 3) {
      return {
        status: 200,
        resposta: 'Diante de pré-eclâmpsia com sinais de gravidade (hipertensão grave e cefaleia), indica-se internação imediata, sulfato de magnésio e anti-hipertensivo.',
        resultados: [
          { fonte: 'FEBRASGO', trecho: 'Conduta imediata na hipertensão grave com cefaleia: sulfato de magnésio e internação.', relevancia: 0.91 },
          { fonte: 'ACOG', trecho: 'Manejo de hipertensão grave e cefaleia com sulfato de magnésio.', relevancia: 0.88 },
        ],
      };
    }
    if (stage === 4) {
      return {
        status: 200,
        resposta: 'Iminência de eclâmpsia com trombocitopenia e plaquetas abaixo de 100.000 sugere síndrome HELLP e exige sulfato de magnésio imediato.',
        resultados: [
          { fonte: 'FEBRASGO', trecho: 'Prevenção de eclâmpsia, contagem de plaquetas e rastreio de síndrome HELLP.', relevancia: 0.92 },
          { fonte: 'ACOG', trecho: 'Manejo de plaquetas baixas na síndrome HELLP e iminência de eclâmpsia.', relevancia: 0.89 },
        ],
      };
    }
    if (stage === 5) {
      return {
        status: 200,
        resposta: 'Na eclâmpsia instalada com convulsão, estabiliza-se a paciente com sulfato de magnésio, controla-se a pressão e programa-se o parto.',
        resultados: [
          { fonte: 'FEBRASGO', trecho: 'Controle de convulsão na eclâmpsia com sulfato de magnésio e programação do parto.', relevancia: 0.95 },
          { fonte: 'ACOG', trecho: 'Manejo de convulsão na gravidez com sulfato de magnésio e indicação de parto.', relevancia: 0.90 },
        ],
      };
    }
  }

  if (scenarioId === 'diabetes_gestacional') {
    if (stage === 1) {
      return {
        status: 200,
        resposta: 'O diagnóstico de diabetes gestacional é confirmado por glicemia de jejum alterada ou TOTG 75g alterado, definindo metas de glicemia e dieta.',
        resultados: [
          { fonte: 'Ministério da Saúde', trecho: 'Critérios diagnósticos de diabetes gestacional com TOTG e metas de glicemia.', relevancia: 0.89 },
        ],
      };
    }
    if (stage === 2) {
      return {
        status: 200,
        resposta: 'Na falha do controle por dieta e exercício, indica-se insulina mantendo a monitorização intensiva da glicemia capilar.',
        resultados: [
          { fonte: 'Ministério da Saúde', trecho: 'Indicação de insulina na falha da dieta e monitorização da glicemia.', relevancia: 0.90 },
        ],
      };
    }
    if (stage === 3) {
      return {
        status: 200,
        resposta: 'Descontrole da glicemia com risco de macrossomia fetal requer vigilância seriada do crescimento fetal e controle glicêmico.',
        resultados: [
          { fonte: 'Ministério da Saúde', trecho: 'Vigilância de macrossomia e crescimento fetal em diabetes gestacional com descontrole de glicemia.', relevancia: 0.90 },
        ],
      };
    }
    if (stage === 4) {
      return {
        status: 200,
        resposta: 'Feto macrossômico com polidrâmnio no termo exige planejamento cuidadoso do parto para prevenir sofrimento fetal intraparto.',
        resultados: [
          { fonte: 'Ministério da Saúde', trecho: 'Planejamento do parto, manejo de polidrâmnio e prevenção de sofrimento fetal intraparto.', relevancia: 0.92 },
        ],
      };
    }
  }

  if (scenarioId === 'ciur') {
    if (stage === 1) {
      return {
        status: 200,
        resposta: 'Feto pequeno com peso no percentil 8 e Doppler normal exige acompanhamento do crescimento fetal seriado com estudo Doppler.',
        resultados: [
          { fonte: 'Ministério da Saúde', trecho: 'Avaliação seriada de crescimento fetal e percentil com vigilância por Doppler.', relevancia: 0.89 },
        ],
      };
    }
    if (stage === 2) {
      return {
        status: 200,
        resposta: 'Restrição de crescimento com alteração na artéria umbilical e centralização demanda estudo Doppler e vigilância fetal rigorosa.',
        resultados: [
          { fonte: 'Ministério da Saúde', trecho: 'Vigilância fetal em CIUR com aumento de resistência na artéria umbilical avaliada por Doppler.', relevancia: 0.91 },
        ],
      };
    }
    if (stage === 3) {
      return {
        status: 200,
        resposta: 'Diástole zero em artéria umbilical na 32ª semana é marcador grave de insuficiência placentária, exigindo Doppler diário e cardiotocografia.',
        resultados: [
          { fonte: 'Ministério da Saúde', trecho: 'Manejo de diástole zero com avaliação por Doppler e cardiotocografia computadorizada.', relevancia: 0.93 },
        ],
      };
    }
    if (stage === 4) {
      return {
        status: 200,
        resposta: 'Fluxo reverso na artéria umbilical é indicação formal de parto imediato e resolução da gestação para evitar óbito fetal.',
        resultados: [
          { fonte: 'Ministério da Saúde', trecho: 'Fluxo reverso impõe parto imediato e resolução da gravidez.', relevancia: 0.95 },
        ],
      };
    }
  }

  if (scenarioId === 'edge_cases') {
    if (stage === 1) {
      return {
        status: 200,
        resposta: 'Só consigo ajudar com dúvidas sobre o pré-natal.',
        resultados: [],
      };
    }
    if (stage === 2) {
      return {
        status: 200,
        resposta: 'Isso pode ser um sinal de alarme. Procure agora a maternidade ou um serviço de urgência, ou ligue 192 (SAMU).',
        resultados: [
          { fonte: 'Caderneta da Gestante', trecho: 'Sinais de alarme: sangramento vaginal, cefaleia refratária e dor intensa exigem urgência.', relevancia: 0.98 },
        ],
      };
    }
    if (stage === 3) {
      return {
        status: 200,
        resposta: 'Não encontrei isso nas fontes aprovadas. Converse com seu médico.',
        resultados: [],
      };
    }
    if (stage === 4) {
      return {
        status: 200,
        resposta: 'Só consigo ajudar com dúvidas sobre o pré-natal. Não posso orientar sobre isso. Converse com seu médico.',
        resultados: [],
      };
    }
    if (stage === 5) {
      return {
        status: 200,
        resposta: 'Conforme a diretriz oficial mais recente do Ministério da Saúde e FEBRASGO, a recomendação atualizada prevalece sobre normas anteriores.',
        resultados: [
          { fonte: 'Ministério da Saúde 2022', trecho: 'Diretriz mais recente sobre vigilância e metas no pré-natal.', relevancia: 0.95 },
          { fonte: 'FEBRASGO 2021', trecho: 'Protocolo atualizado de pré-eclâmpsia e sulfato de magnésio.', relevancia: 0.90 },
        ],
      };
    }
    if (stage === 6) {
      return {
        status: 200,
        resposta: 'Não consegui responder agora. Tente de novo em instantes.',
        degraded: true,
        resultados: [],
      };
    }
  }

  // --- Fallback por inferência de termos na query ---

  // 1. Fora de escopo
  if (
    normalized.includes('motor') ||
    normalized.includes('carro') ||
    normalized.includes('australia') ||
    normalized.includes('imposto')
  ) {
    return {
      status: 200,
      resposta: 'Só consigo ajudar com dúvidas sobre o pré-natal.',
      resultados: [],
    };
  }

  // 2. Sinal de urgência / alarme (#155)
  if (
    normalized.includes('sangramento') ||
    normalized.includes('dor subita') ||
    normalized.includes('170/110') ||
    normalized.includes('sinal de alarme')
  ) {
    return {
      status: 200,
      resposta: 'Isso pode ser um sinal de alarme. Procure agora a maternidade ou um serviço de urgência, ou ligue 192 (SAMU).',
      resultados: [
        { fonte: 'Caderneta da Gestante', trecho: 'Sinais de alarme exigem encaminhamento imediato.', relevancia: 0.98 },
      ],
    };
  }

  // 3. Fonte ausente no catálogo (#155)
  if (
    normalized.includes('graviola') ||
    normalized.includes('barbante') ||
    normalized.includes('ozonioterapia')
  ) {
    return {
      status: 200,
      resposta: 'Não encontrei isso nas fontes aprovadas. Converse com seu médico.',
      resultados: [],
    };
  }

  // 4. Prompt injection / evasão / tentativa de prescrição
  if (
    normalized.includes('ignore todas as instrucoes') ||
    normalized.includes('dr. gpt') ||
    normalized.includes('system override') ||
    normalized.includes('receite') ||
    normalized.includes('prescreva') ||
    normalized.includes('sem filtros')
  ) {
    return {
      status: 200,
      resposta: 'Só consigo ajudar com dúvidas sobre o pré-natal. Não posso orientar sobre isso. Converse com seu médico.',
      resultados: [],
    };
  }

  // 5. Contexto conflitante (prevalência temporal #127)
  if (
    normalized.includes('conflitante') ||
    normalized.includes('diretriz mais recente') ||
    normalized.includes('protocolo atualizado')
  ) {
    return {
      status: 200,
      resposta: 'Conforme a diretriz oficial mais recente do Ministério da Saúde e FEBRASGO, a recomendação atualizada prevalece sobre normas anteriores.',
      resultados: [
        { fonte: 'Ministério da Saúde 2022', trecho: 'Diretriz mais recente sobre vigilância e metas no pré-natal.', relevancia: 0.95 },
        { fonte: 'FEBRASGO 2021', trecho: 'Protocolo atualizado de pré-eclâmpsia e sulfato de magnésio.', relevancia: 0.90 },
      ],
    };
  }

  // 6. Timeout ou erro de provedor
  if (
    normalized.includes('timeout') ||
    normalized.includes('503') ||
    normalized.includes('queda temporaria')
  ) {
    return {
      status: 200,
      resposta: 'Não consegui responder agora. Tente de novo em instantes.',
      degraded: true,
      resultados: [],
    };
  }

  // Fallback seguro
  return {
    status: 200,
    resposta: 'Esta informação é educativa e não substitui avaliação médica. Orientações devem ser confirmadas pelo obstetra.',
    resultados: [
      { fonte: 'Ministério da Saúde', trecho: 'Manual de Atenção ao Pré-Natal de Baixo Risco.', relevancia: 0.75 },
    ],
  };
}

module.exports = {
  getMockRagAnswer,
  normalizeText,
};
