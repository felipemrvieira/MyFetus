// E3-07: sinais de alarme do diário da gestante.
// Função pura e determinística: não consulta banco, não chama IA e não depende de push.
// É a única fonte das regras de alarme do diário; alertEventService e
// dailyRiskFeedService consomem o resultado daqui.

const catalog = require('../data/daily-alarm-rules.json');

const { thresholds } = catalog;
const RULES = Object.freeze(Object.fromEntries(catalog.rules.map((rule) => [rule.id, rule])));

function finiteOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function hasHighBloodPressure(systolic, diastolic) {
  const high = finiteOrNull(systolic);
  const low = finiteOrNull(diastolic);
  return (high !== null && high >= thresholds.highBloodPressure.systolic) ||
    (low !== null && low >= thresholds.highBloodPressure.diastolic);
}

function hasBloodPressure(systolic, diastolic) {
  return finiteOrNull(systolic) !== null || finiteOrNull(diastolic) !== null;
}

function trigger(ruleId, signalCodes) {
  const rule = RULES[ruleId];
  if (!rule) throw new Error(`regra de alarme desconhecida: ${ruleId}`);
  return { rule_id: rule.id, version: rule.version, severity: rule.severity, signal_codes: signalCodes };
}

/**
 * @param {object} entry   entrada do diário já normalizada/serializada
 * @param {{ weeks?: number|null }} context  idade gestacional atual (null = desconhecida)
 */
function evaluateDailyAlarms(entry = {}, { weeks = null } = {}) {
  const symptoms = new Set(Array.isArray(entry.alarm_symptoms) ? entry.alarm_symptoms : []);
  const gestationalWeeks = finiteOrNull(weeks);
  const temperature = finiteOrNull(entry.temperature_c);
  const triggered = [];
  const pending = [];

  if (symptoms.has('sangramento')) triggered.push(trigger('E3-07.bleeding', ['sangramento']));
  if (symptoms.has('perda_liquido')) triggered.push(trigger('E3-07.fluid_loss', ['perda_liquido']));

  if (symptoms.has('cefaleia_intensa')) {
    if (hasHighBloodPressure(entry.systolic, entry.diastolic)) {
      triggered.push(trigger('E3-07.headache_high_bp', ['cefaleia_intensa', 'blood_pressure_high']));
    } else {
      // Suposição: sem PA alta (ou sem PA), orienta avaliação e não descarta risco.
      triggered.push(trigger('E3-07.headache_unconfirmed', ['cefaleia_intensa']));
      if (!hasBloodPressure(entry.systolic, entry.diastolic)) pending.push('blood_pressure_missing');
    }
  }

  if (temperature !== null && temperature >= thresholds.feverCelsius) {
    triggered.push(trigger('E3-07.fever_38', ['temperature_c']));
  } else if (symptoms.has('febre') && temperature === null) {
    // Suposição: febre relatada sem medida não é descartada.
    triggered.push(trigger('E3-07.fever_unmeasured', ['febre']));
    pending.push('temperature_missing');
  }

  if (symptoms.has('contracoes')) {
    if (gestationalWeeks === null) {
      // Suposição: IG desconhecida é tratada como pré-termo (conservador).
      triggered.push(trigger('E3-07.preterm_contractions', ['contracoes']));
      pending.push('gestational_age_unknown');
    } else if (gestationalWeeks < thresholds.pretermWeeks) {
      triggered.push(trigger('E3-07.preterm_contractions', ['contracoes']));
    } else {
      triggered.push(trigger('E3-07.term_contractions', ['contracoes']));
    }
  }

  if (entry.reduced_fetal_movements === true) {
    // O diário já rejeita o campo antes de 28 semanas (dailyEntryRuleService).
    triggered.push(trigger('E3-07.reduced_movements', ['reduced_fetal_movements']));
  }

  const level = triggered.some((item) => item.severity === 'red')
    ? 'red'
    : triggered.some((item) => item.severity === 'yellow') ? 'yellow' : 'green';
  const orientationId = level === 'red' ? 'seek_care_now_v1' : level === 'yellow' ? 'seek_evaluation_v1' : null;
  const orientation = orientationId
    ? { id: orientationId, patient: catalog.orientations[orientationId].patient, disclaimer: catalog.orientations[orientationId].disclaimer }
    : null;

  return { catalog_version: catalog.catalogVersion, level, triggered, orientation, pending };
}

// Detalhe da auditoria: regra (id@versão), dado (códigos de sinal) e orientação exibida.
// Somente códigos; nunca texto livre nem valores clínicos brutos.
function buildAlarmAuditDetail(evaluation, { pregnancyId, alertEventIds = [] } = {}) {
  return {
    pregnancy_id: pregnancyId,
    catalog_version: evaluation.catalog_version,
    level: evaluation.level,
    rule_ids: evaluation.triggered.map((item) => `${item.rule_id}@${item.version}`),
    signal_codes: [...new Set(evaluation.triggered.flatMap((item) => item.signal_codes))],
    pending: evaluation.pending,
    orientation_id: evaluation.orientation?.id || null,
    alert_event_ids: alertEventIds,
  };
}

module.exports = {
  buildAlarmAuditDetail,
  DAILY_ALARM_CATALOG_VERSION: catalog.catalogVersion,
  DAILY_ALARM_RULE_IDS: Object.freeze(Object.keys(RULES)),
  evaluateDailyAlarms,
  hasHighBloodPressure,
};
