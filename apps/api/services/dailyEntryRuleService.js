const MOVEMENT_WEEK_START = 28;
const MIN_WEEK_RULE_START = 6;

function normalizeWeeks(value) {
  const weeks = Number(value);
  return Number.isFinite(weeks) && weeks >= 0 && weeks <= 45 ? weeks : null;
}

function buildDailyEntryRuleContext(pregnancy = {}) {
  const weeks = normalizeWeeks(pregnancy.weeks);
  const multiple = Boolean(pregnancy.isMultiplePregnancy || pregnancy.gestacao_multipla);
  const source = pregnancy.ig_ultrassonografia ? 'ultrassom' : pregnancy.dum ? 'dum' : 'indisponivel';

  return {
    weeks,
    source,
    multiple_pregnancy: multiple,
    weekly_rules_enabled: weeks !== null && weeks >= MIN_WEEK_RULE_START,
    reduced_fetal_movements_enabled: weeks !== null && weeks >= MOVEMENT_WEEK_START,
    signals_that_evaluate: ['alarm_symptoms', 'reduced_fetal_movements', 'systolic', 'diastolic'],
  };
}

function validateDailyEntryByGestationalAge(entry, context) {
  if (
    entry.reduced_fetal_movements !== null &&
    entry.reduced_fetal_movements !== undefined &&
    !context.reduced_fetal_movements_enabled
  ) {
    const error = new Error('reduced_fetal_movements so pode ser informado a partir de 28 semanas');
    error.code = 'MOVEMENTS_NOT_APPLICABLE';
    throw error;
  }
  return entry;
}

module.exports = {
  MIN_WEEK_RULE_START,
  MOVEMENT_WEEK_START,
  buildDailyEntryRuleContext,
  normalizeWeeks,
  validateDailyEntryByGestationalAge,
};
