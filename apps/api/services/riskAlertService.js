const { evaluateRisk } = require('./riskEngine');

const FAMILY_FIELDS = [
  'antecedentes_diabetes',
  'antecedentes_hipertensao',
  'antecedentes_gemelar',
  'antecedentes_outros',
];

const CLINICAL_FIELDS = [
  'antecedentes_clinicos_diabetes',
  'antecedentes_clinicos_infeccao_urinaria',
  'antecedentes_clinicos_infertilidade',
  'antecedentes_clinicos_dific_amamentacao',
  'antecedentes_clinicos_cardiopatia',
  'antecedentes_clinicos_tromboembolismo',
  'antecedentes_clinicos_hipertensao_arterial',
  'antecedentes_clinicos_cirur_per_uterina',
  'antecedentes_clinicos_cirurgia',
  'antecedentes_clinicos_outros',
];

const PREVIOUS_PREGNANCY_FIELDS = [
  'gestacao_eclampsia_pre_eclampsia',
  'gestacao_bebe_maior_45',
  'gestacao_mais_tres_abortos',
  'gestacao_nascidos_mortos',
  'gestacao_mortos_primeira_semana',
  'gestacao_mortos_depois_primeira_semana',
  'gestacao_final_gestacao_anterior_1ano',
];

const CURRENT_PREGNANCY_FLAG_MAP = {
  gestacao_atual_hiv_aids: 'hiv',
  gestacao_atual_sifilis: 'syphilis',
  gestacao_atual_hipertensao_arterial: 'hypertension',
  gestacao_atual_diabete_gestacional: 'gestational_diabetes',
  gestacao_atual_uso_insulina: 'insulin',
  gestacao_atual_anemia: 'anemia',
  gestacao_atual_infeccao_urinaria: 'urinary_infection',
  gestacao_atual_toxoplasmose: 'toxoplasmosis',
  gestacao_atual_fumante: 'smoking',
  gestacao_atual_alcool: 'alcohol',
  gestacao_atual_imuniz_rh: 'rh_immunization',
  gestacao_atual_febre: 'fever',
  exantema_rash: 'rash',
  gestacao_atual_hemorragia_1trim: 'bleeding',
  gestacao_atual_hemorragia_2trim: 'bleeding',
  gestacao_atual_hemorragia_3trim: 'bleeding',
  gestacao_atual_rut_prem_membrana: 'fluid_loss',
};

const CATEGORY_KEYS = {
  maternal_age: 'idade_materna',
  blood_pressure: 'pressao_arterial',
  blood_glucose: 'glicemia',
  pre_pregnancy_bmi: 'imc',
  fundal_height: 'altura_uterina',
  fetal_heart_rate: 'frequencia_cardiaca_fetal',
  gestational_age: 'semanas_gestacao',
  family_history: 'antecedentes_familiares',
  clinical_history: 'antecedentes_clinicos',
  previous_pregnancy: 'gestacao_anterior',
  current_pregnancy: 'gestacao_atual',
  vaccination: 'vacinas',
};

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

function calculateAge(birthdate, now = new Date()) {
  if (!birthdate) return undefined;
  const birth = new Date(birthdate);
  if (Number.isNaN(birth.getTime())) return undefined;

  let age = now.getFullYear() - birth.getFullYear();
  const monthDelta = now.getMonth() - birth.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && now.getDate() < birth.getDate())) age -= 1;
  return age >= 0 ? age : undefined;
}

function anyTruthy(record, fields) {
  return fields.some((field) => Boolean(record?.[field]));
}

function buildCurrentPregnancyFlags(record) {
  return Object.entries(CURRENT_PREGNANCY_FLAG_MAP)
    .filter(([field]) => Boolean(record?.[field]))
    .map(([, flag]) => flag);
}

function buildRiskInput(patient, pregnancy, options = {}) {
  const input = {};
  const maternalAge = calculateAge(patient?.birthdate, options.now);
  const systolic = positiveNumber(patient?.pressao_sistole);
  const diastolic = positiveNumber(patient?.pressao_diastole);
  const prePregnancyWeight = positiveNumber(patient?.peso_pregestacional);
  const height = positiveNumber(patient?.altura);
  const gestationalWeeks = positiveNumber(pregnancy?.weeks);
  // `frequencia_cardiaca` is ambiguous in the current schema: the two mobile
  // forms have historically written maternal heart rate and BCF to the same
  // column. Until the columns are split, do not use that value as FCF.
  const fetalHeartRate = positiveNumber(pregnancy?.bcf);
  const fundalHeight = positiveNumber(pregnancy?.altura_uterina);

  if (maternalAge !== undefined) input.maternalAge = maternalAge;
  if (systolic !== undefined) input.systolic = systolic;
  if (diastolic !== undefined) input.diastolic = diastolic;
  if (prePregnancyWeight !== undefined && height !== undefined) {
    input.prePregnancyBmi = prePregnancyWeight / (height * height);
  }
  if (gestationalWeeks !== undefined) input.gestationalWeeks = gestationalWeeks;
  if (fetalHeartRate !== undefined) input.fetalHeartRate = fetalHeartRate;
  if (fundalHeight !== undefined) input.fundalHeight = fundalHeight;

  // O schema legado armazena glicemia sem o tipo do exame. Não inferimos jejum,
  // casual ou TOTG: resultado sem contexto permanece fora do motor clínico.
  if (options.glucoseType && positiveNumber(pregnancy?.glicemia) !== undefined) {
    input.glucoseType = options.glucoseType;
    input.glucoseValue = positiveNumber(pregnancy.glicemia);
  }

  input.familyHistory = anyTruthy(patient, FAMILY_FIELDS);
  input.clinicalHistory = anyTruthy(patient, CLINICAL_FIELDS);
  input.previousPregnancyRisk = anyTruthy(patient, PREVIOUS_PREGNANCY_FIELDS);
  input.currentPregnancyFlags = buildCurrentPregnancyFlags(patient);

  // O calendário vacinal por IG ainda não está representado no schema do
  // cadastro. Deixamos a categoria pendente em vez de contar vacinas de forma
  // aritmética ou inferir elegibilidade.
  return input;
}

function categoryDetail(category) {
  if (category.status === 'pending_decision') {
    return category.reason || 'Regra aguardando contrato clínico aprovado.';
  }
  if (category.status === 'pending_data') {
    return `Dados pendentes: ${category.missingFields.join(', ')}.`;
  }
  if (category.alerts.length === 0) return 'Nenhum alerta identificado pelos dados informados.';
  return category.alerts.map((alert) => alert.evidence).join('; ');
}

function serializeCategory(category) {
  const key = CATEGORY_KEYS[category.category] || category.category;
  const pending = category.status.startsWith('pending_');
  const firstAlert = category.alerts[0];
  return [
    key,
    {
      level: pending ? 'pending' : category.severity,
      status: category.status,
      label: pending
        ? 'Dados pendentes'
        : firstAlert?.evidence || (category.status === 'alert' ? 'Atenção' : category.label),
      detail: categoryDetail(category),
      missing_fields: category.missingFields,
      alerts: category.alerts,
    },
  ];
}

function evaluatePatientRisk(patient, pregnancy, options = {}) {
  const evaluation = evaluateRisk(buildRiskInput(patient, pregnancy, options), options);
  const categories = Object.fromEntries(evaluation.categories.map(serializeCategory));
  const alertCounts = { green: 0, yellow: 0, red: 0, pending: 0 };

  evaluation.categories.forEach((category) => {
    if (category.status.startsWith('pending_')) alertCounts.pending += 1;
    else alertCounts[category.severity] += 1;
  });

  return {
    catalog_version: evaluation.catalogVersion,
    overall_level: evaluation.overallSeverity,
    alert_counts: alertCounts,
    categories,
  };
}

module.exports = {
  CATEGORY_KEYS,
  buildRiskInput,
  calculateAge,
  evaluatePatientRisk,
};
