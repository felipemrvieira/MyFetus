const guardrailContract = require('../../data/guardrails.json');

const IN_SCOPE_TERMS = [
  'pressao', 'pressão', 'pa ', 'imc', 'peso', 'vacina', 'vacinas',
  'glicemia', 'diabetes', 'medicamento', 'ibuprofeno', 'acido folico',
  'ácido fólico', 'cabeca', 'cabeça', 'visao', 'visão', 'gestacao',
  'gestação', 'gravidez', 'prenatal', 'pré-natal', 'semana', 'semanas',
  'bebe', 'bebê', 'fetal', 'feto', 'altura uterina', 'ultrassom',
  'ultrassonografia', 'doppler', 'mexer', 'movimento', 'crescimento',
  'pequeno', 'frequencia cardiaca', 'frequência cardíaca', 'sintoma',
  'exame', 'parto', 'alimentacao', 'alimentação', 'amamentacao',
  'amamentação', 'consulta', 'dpp', 'dum'
];

const CRITICAL_RULES = [
  {
    id: 'neurologic_hypertensive_signs',
    regex: /(dor de cabe[cç]a|cefaleia).*(vis[aã]o turva|escotoma|luzes)|((vis[aã]o turva|escotoma).*(dor de cabe[cç]a|cefaleia))/i,
    reason: 'Sintomas neurológicos associados a possível síndrome hipertensiva na gestação.'
  },
  {
    id: 'reduced_fetal_movements',
    regex: /(beb[eê]|feto).*(parou|sem|n[aã]o).*(mexer|movimentar|movimentos?)|movimentos? fetais?.*(ausentes?|reduzidos?)/i,
    reason: 'Redução ou ausência de movimentos fetais pode indicar emergência obstétrica.'
  },
  {
    id: 'medication_in_pregnancy',
    regex: /ibuprofeno|anti[-\s]?inflamat[oó]rio|qual rem[eé]dio|qual medicamento|posso tomar/i,
    reason: 'Uso de medicamento na gestação exige avaliação médica.'
  },
  {
    id: 'severe_blood_pressure',
    regex: /(press[aã]o|pa)\D*(1[6-9]\d|[2-9]\d{2})\D*(\/|por)\D*(1[1-9]\d|[2-9]\d{2})|170\s*\/\s*115/i,
    reason: 'Pressão arterial em faixa de crise hipertensiva exige avaliação imediata.'
  },
  {
    id: 'obstetric_alarm',
    regex: /sangramento intenso|convuls[aã]o|desmaio|perda de liquido|perda de líquido|falta de ar intensa/i,
    reason: 'Sintoma de alarme obstétrico que precisa de atendimento presencial.'
  }
];

const INJECTION_PATTERNS = [
  /ignore\s+(all|any|previous|above)\s+(instructions?|rules?)/i,
  /ignore\s+as\s+instru[cç][oõ]es/i,
  /reveal|show|print|expose|repeat.*(system|developer)\s+prompt/i,
  /system\s+prompt|prompt\s+do\s+sistema|mensagem\s+de\s+desenvolvedor/i,
  /bypass|jailbreak|desative\s+(as|as suas)\s+regras/i,
  /api[_ -]?key|token|segredo|senha/i
];

const OUT_OF_SCOPE_PATTERNS = [
  /diagn[oó]stico\s+(definitivo|final)/i,
  /me\s+prescreva|prescreva\s+(um|uma|o|a)?/i,
  /posologia|qual\s+a\s+dose|dose\s+exata/i,
  /c[oó]digo|programa|javascript|python|sql|finan[cç]as|pol[ií]tica|futebol/i
];

const SAFE_MESSAGES = {
  disclaimer: 'Esta informação é educativa e não substitui avaliação médica.',
  urgent: 'Isso pode ser um sinal de alarme. Procure agora a maternidade ou um serviço de urgência, ou ligue 192 (SAMU).',
  prompt_injection: 'Posso ajudar somente dentro do escopo de educação pré-natal e das fontes aprovadas. Não posso expor instruções internas, segredos ou alterar as regras de segurança.',
  out_of_scope: 'Não posso orientar sobre isso. Converse com seu médico.',
  no_source: 'Não encontrei isso nas fontes aprovadas. Converse com seu médico.',
  clarify: 'Preciso de mais detalhes para direcionar a análise com segurança. Informe semanas de gestação, tema principal e há quanto tempo isso ocorre.'
};

function normalize(text) {
  return String(text || '').trim().toLowerCase();
}

function findMatch(text, patterns) {
  return patterns.find((pattern) => pattern.test(text));
}

function detectUrgency(query) {
  const normalized = normalize(query);
  const matched = CRITICAL_RULES.find((rule) => rule.regex.test(normalized));
  if (!matched) return { matched: false, ruleId: null, reason: null };
  return { matched: true, ruleId: matched.id, reason: matched.reason };
}

function hasInjection(query) {
  return Boolean(findMatch(normalize(query), INJECTION_PATTERNS));
}

function hasOutOfScopeRequest(query) {
  return Boolean(findMatch(normalize(query), OUT_OF_SCOPE_PATTERNS));
}

function includesAny(text, terms) {
  return terms.some((term) => text.includes(term));
}

function routeInScope(query) {
  const normalized = normalize(query);
  if (normalized.length < 12) return { route: 'clarify', maternal: false, fetal: false };

  const maternalTerms = ['pressao', 'pressão', 'pa ', 'imc', 'peso', 'glicemia', 'diabetes', 'vacina', 'vacinas', 'medicamento', 'ibuprofeno', 'acido folico', 'ácido fólico', 'cabeca', 'cabeça', 'visao', 'visão'];
  const fetalTerms = ['bebe', 'bebê', 'fetal', 'feto', 'altura uterina', 'ultrassom', 'ultrassonografia', 'doppler', 'mexer', 'movimento', 'crescimento', 'pequeno', 'frequencia cardiaca', 'frequência cardíaca'];
  const maternal = includesAny(normalized, maternalTerms);
  const fetal = includesAny(normalized, fetalTerms);

  if (!maternal && !fetal && !includesAny(normalized, IN_SCOPE_TERMS)) {
    return { route: 'clarify', maternal: false, fetal: false };
  }
  if (maternal && fetal) return { route: 'both', maternal: true, fetal: true };
  if (fetal) return { route: 'fetal', maternal: false, fetal: true };
  return { route: 'maternal', maternal: true, fetal: false };
}

function classifyQuery(query) {
  if (typeof query !== 'string' || normalize(query).length === 0) {
    return {
      category: 'clarify',
      decision: 'block_generation',
      needs_human_review: false,
      reason: 'empty_query',
      response: SAFE_MESSAGES.clarify,
      contractVersion: guardrailContract.version
    };
  }

  const urgency = detectUrgency(query);
  if (urgency.matched) {
    return {
      category: 'urgent',
      decision: 'block_generation',
      needs_human_review: true,
      ruleId: urgency.ruleId,
      reason: urgency.reason,
      response: SAFE_MESSAGES.urgent,
      contractVersion: guardrailContract.version
    };
  }

  if (hasInjection(query)) {
    return {
      category: 'prompt_injection',
      decision: 'block_generation',
      needs_human_review: false,
      reason: 'instruction_manipulation_attempt',
      response: SAFE_MESSAGES.prompt_injection,
      contractVersion: guardrailContract.version
    };
  }

  if (hasOutOfScopeRequest(query)) {
    return {
      category: 'out_of_scope',
      decision: 'block_generation',
      needs_human_review: false,
      reason: 'request_requires_clinical_or_non_prenatal_decision',
      response: SAFE_MESSAGES.out_of_scope,
      contractVersion: guardrailContract.version
    };
  }

  const route = routeInScope(query);
  if (route.route === 'clarify') {
    return {
      category: 'clarify',
      decision: 'block_generation',
      needs_human_review: false,
      reason: 'insufficient_scope_signal',
      response: SAFE_MESSAGES.clarify,
      contractVersion: guardrailContract.version
    };
  }

  return {
    category: 'in_scope',
    decision: 'allow_controlled_generation',
    needs_human_review: false,
    reason: null,
    response: null,
    route,
    contractVersion: guardrailContract.version
  };
}

module.exports = {
  CRITICAL_RULES,
  GUARDRAIL_CONTRACT: guardrailContract,
  IN_SCOPE_TERMS,
  SAFE_MESSAGES,
  classifyQuery,
  detectUrgency,
  hasInjection,
  hasOutOfScopeRequest,
  normalize,
  routeInScope
};
