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

  if (symptoms.has('sangramento')) triggered.push(trigger('E3-07.bleeding', ['sangramento']));
  if (symptoms.has('perda_liquido')) triggered.push(trigger('E3-07.fluid_loss', ['perda_liquido']));

  // O cliente aprovou cada sinal como urgente, sem depender de PA, IG ou medida.
  if (symptoms.has('cefaleia_intensa')) {
    triggered.push(trigger('E3-07.severe_headache', ['cefaleia_intensa']));
  }

  if (symptoms.has('febre') || (temperature !== null && temperature >= thresholds.feverCelsius)) {
    triggered.push(trigger('E3-07.fever', symptoms.has('febre') ? ['febre'] : ['temperature_c']));
  }

  if (symptoms.has('desmaio_convulsao')) {
    triggered.push(trigger('E3-07.fainting_or_seizure', ['desmaio_convulsao']));
  }

  if (symptoms.has('contracoes')) {
    triggered.push(trigger('E3-07.contractions_or_abdominal_pain', ['contracoes']));
  }

  if (entry.reduced_fetal_movements === true && gestationalWeeks !== null && gestationalWeeks >= thresholds.movementsFromWeeks) {
    // O diário já rejeita o campo antes de 28 semanas (dailyEntryRuleService).
    triggered.push(trigger('E3-07.reduced_movements', ['reduced_fetal_movements']));
  }

  const level = triggered.some((item) => item.severity === 'red')
    ? 'red'
    : triggered.some((item) => item.severity === 'yellow') ? 'yellow' : 'green';
  const orientationId = level === 'red' ? 'seek_care_now_v1' : null;
  const orientation = orientationId
    ? { id: orientationId, patient: catalog.orientations[orientationId].patient, disclaimer: catalog.orientations[orientationId].disclaimer }
    : null;

  return { catalog_version: catalog.catalogVersion, level, triggered, orientation, pending: [] };
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
};
