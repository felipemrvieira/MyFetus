const MIN_RULE_WEEKS = 6;
const WEEK_DEPENDENT_MEASUREMENT_WEEKS = 20;

function finiteWeeks(value) {
  const weeks = Number(value);
  return Number.isFinite(weeks) && weeks >= 0 && weeks <= 45 ? weeks : null;
}

function resolveGestationalAgeSource(pregnancy = {}) {
  if (pregnancy.ig_ultrassonografia) return 'ultrassom';
  if (pregnancy.dum) return 'dum';
  return 'indisponivel';
}

function buildGestationalRuleContext(pregnancy = {}, options = {}) {
  const weeks = finiteWeeks(pregnancy.weeks ?? options.weeks);
  const multiple = Boolean(
    options.isMultiplePregnancy ?? pregnancy.isMultiplePregnancy ?? pregnancy.gestacao_multipla
  );
  const source = resolveGestationalAgeSource(pregnancy);

  return {
    weeks,
    source,
    sourceLabel: source === 'ultrassom' ? 'Ultrassom' : source === 'dum' ? 'DUM' : 'Indisponível',
    hasRuleByWeek: weeks !== null && weeks >= MIN_RULE_WEEKS,
    fundalHeightApplicable: weeks !== null && weeks >= WEEK_DEPENDENT_MEASUREMENT_WEEKS && !multiple,
    fetalHeartRateApplicable: weeks !== null && weeks >= WEEK_DEPENDENT_MEASUREMENT_WEEKS,
    weightGainApplicable: weeks !== null && weeks >= MIN_RULE_WEEKS && !multiple,
    vaccinationApplicable: weeks !== null && weeks >= MIN_RULE_WEEKS,
    multiplePregnancy: multiple,
  };
}

function notApplicableCategory(category, reason) {
  return {
    ...category,
    status: 'not_applicable',
    severity: 'pending',
    missingFields: [],
    alerts: [],
    reason,
  };
}

function applyGestationalPolicy(categories, context) {
  const byCategory = new Map(categories.map((category) => [category.category, category]));

  if (context.weeks !== null && context.weeks < MIN_RULE_WEEKS) {
    for (const category of ['fundal_height', 'fetal_heart_rate', 'gestational_age', 'vaccination']) {
      if (byCategory.has(category)) {
        byCategory.set(category, notApplicableCategory(
          byCategory.get(category),
          'Não há regra por idade gestacional antes de 6 semanas.'
        ));
      }
    }
  } else {
    if (!context.fundalHeightApplicable && byCategory.has('fundal_height')) {
      byCategory.set('fundal_height', notApplicableCategory(
        byCategory.get('fundal_height'),
        context.multiplePregnancy
          ? 'Altura uterina desligada para gestação múltipla nesta versão.'
          : 'Altura uterina passa a ser avaliada a partir de 20 semanas.'
      ));
    }
    if (!context.fetalHeartRateApplicable && byCategory.has('fetal_heart_rate')) {
      byCategory.set('fetal_heart_rate', notApplicableCategory(
        byCategory.get('fetal_heart_rate'),
        'FCF passa a ser avaliada a partir de 20 semanas.'
      ));
    }
  }

  return categories.map((category) => byCategory.get(category.category) || category);
}

module.exports = {
  MIN_RULE_WEEKS,
  WEEK_DEPENDENT_MEASUREMENT_WEEKS,
  applyGestationalPolicy,
  buildGestationalRuleContext,
  finiteWeeks,
  resolveGestationalAgeSource,
};
