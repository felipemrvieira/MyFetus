const { autoCloseNormalAlert, upsertAlertEvent } = require('./alertEventService');

const ACCEPTED_STATUS = 'accepted';

function normalizeObservation(observation = {}) {
  return {
    source_id: String(observation.source_id || '').trim(),
    analyte: String(observation.analyte || '').trim().toLowerCase(),
    value: Number(observation.value),
    unit: String(observation.unit || '').trim(),
    status: String(observation.status || '').trim().toLowerCase(),
    glucose_type: observation.glucose_type || null,
  };
}

function acceptedObservations(observations = []) {
  return observations.map(normalizeObservation)
    .filter(observation => observation.status === ACCEPTED_STATUS && observation.source_id && Number.isFinite(observation.value));
}

function buildObservationAlerts(observations, context) {
  const accepted = acceptedObservations(observations);
  const alerts = [];
  const systolic = accepted.find(item => item.analyte === 'pressao_sistolica' || item.analyte === 'systolic')?.value;
  const diastolic = accepted.find(item => item.analyte === 'pressao_diastolica' || item.analyte === 'diastolic')?.value;
  if (systolic !== undefined || diastolic !== undefined) {
    const ruleId = 'exam_blood_pressure';
    const severity = systolic >= 160 || diastolic >= 110 ? 'red' : systolic >= 140 || diastolic >= 90 ? 'yellow' : null;
    if (severity) alerts.push({
      pregnancy_id: context.pregnancyId,
      pregnant_id: context.pregnantId,
      rule_id: ruleId,
      severity,
      source_type: 'lab_result',
      source_id: accepted.find(item => item.analyte.includes('pressao'))?.source_id,
      signal_codes: [severity === 'red' ? 'blood_pressure_severe' : 'blood_pressure_elevated'],
      message: severity === 'red'
        ? 'Isso pode ser um sinal de alarme. Procure agora a maternidade ou um serviço de urgência, ou ligue 192 (SAMU).'
        : 'Pressão arterial em faixa de atenção. Fale com a equipe de saúde.',
    });
    else alerts.push(...normalClosureAlerts(context, ruleId));
  }

  for (const observation of accepted) {
    if (observation.analyte === 'glicemia' || observation.analyte === 'glucose') {
      const threshold = observation.glucose_type === 'casual' ? 200 : 92;
      if (observation.value >= threshold) {
        alerts.push({
          pregnancy_id: context.pregnancyId,
          pregnant_id: context.pregnantId,
          rule_id: `exam_glucose_${observation.glucose_type || 'unknown'}`,
          severity: 'yellow',
          source_type: 'lab_result',
          source_id: observation.source_id,
          signal_codes: ['glucose_attention'],
          message: 'Resultado de glicemia em faixa de atenção. Converse com sua equipe de saúde.',
        });
      }
    }
    if ((observation.analyte === 'fcf' || observation.analyte === 'fetal_heart_rate') && context.gestationalWeeks >= 20) {
      if (observation.value < 110 || observation.value > 160) {
        alerts.push({
          pregnancy_id: context.pregnancyId,
          pregnant_id: context.pregnantId,
          rule_id: 'exam_fetal_heart_rate',
          severity: observation.value < 110 ? 'red' : 'yellow',
          source_type: 'lab_result',
          source_id: observation.source_id,
          signal_codes: [observation.value < 110 ? 'fetal_heart_rate_low' : 'fetal_heart_rate_high'],
          message: observation.value < 110
            ? 'Isso pode ser um sinal de alarme. Procure agora a maternidade ou um serviço de urgência, ou ligue 192 (SAMU).'
            : 'Medida fetal em faixa de atenção. Converse com sua equipe de saúde.',
        });
      }
    }
  }
  return alerts;
}

function normalClosureAlerts(context, ruleId) {
  return [{
    pregnancy_id: context.pregnancyId,
    pregnant_id: context.pregnantId,
    rule_id: ruleId,
    severity: 'yellow',
    source_type: 'lab_result',
    source_id: null,
    signal_codes: ['normal_follow_up'],
    message: 'Nova medida aceita e normal.',
    normal: true,
  }];
}

async function syncAcceptedClinicalObservations(db, observations, context) {
  const normalized = observations.map(normalizeObservation);
  const alerts = buildObservationAlerts(normalized, context);
  const events = [];
  for (const alert of alerts) {
    if (alert.normal) {
      events.push(...await autoCloseNormalAlert(db, {
        pregnancyId: context.pregnancyId,
        ruleId: alert.rule_id,
        severity: alert.severity,
      }));
    } else {
      events.push((await upsertAlertEvent(db, alert)).event);
    }
  }
  return {
    status: normalized.some(item => item.status !== ACCEPTED_STATUS) ? 'partial' : 'evaluated',
    accepted_count: normalized.filter(item => item.status === ACCEPTED_STATUS).length,
    ignored_count: normalized.filter(item => item.status !== ACCEPTED_STATUS).length,
    events,
  };
}

module.exports = {
  ACCEPTED_STATUS,
  acceptedObservations,
  buildObservationAlerts,
  normalizeObservation,
  syncAcceptedClinicalObservations,
};
