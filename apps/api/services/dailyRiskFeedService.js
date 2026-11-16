const { evaluateDailyAlarms } = require('./dailyAlarmRuleService');

const ALARM_LABELS = Object.freeze({
  'E3-07.bleeding': 'Sangramento',
  'E3-07.fluid_loss': 'Perda de líquido',
  'E3-07.severe_headache': 'Dor de cabeça forte, visão embaçada ou inchaço repentino',
  'E3-07.fever': 'Febre',
  'E3-07.contractions_or_abdominal_pain': 'Contrações regulares ou dor forte na barriga',
  'E3-07.fainting_or_seizure': 'Desmaio ou convulsão',
  'E3-07.reduced_movements': 'Relato de bebê mexendo menos',
});

function evaluateBloodPressure(systolic, diastolic) {
  const high = Number(systolic);
  const low = Number(diastolic);
  if (!Number.isFinite(high) && !Number.isFinite(low)) return null;
  if (high >= 160 || low >= 110) return { code: 'blood_pressure_severe', level: 'red', message: 'Pressão arterial em faixa crítica.' };
  if (high >= 140 || low >= 90) return { code: 'blood_pressure_elevated', level: 'yellow', message: 'Pressão arterial em faixa de atenção.' };
  return null;
}

function evaluateDailyEntry(entry, { weeks = null } = {}) {
  const alarms = evaluateDailyAlarms(entry, { weeks });
  const signals = alarms.triggered.map((item) => ({
    code: item.rule_id,
    rule_version: item.version,
    level: item.severity,
    message: ALARM_LABELS[item.rule_id] || 'Sinal de alarme registrado.',
  }));
  const pressure = evaluateBloodPressure(entry.systolic, entry.diastolic);
  if (pressure) signals.push(pressure);
  const level = signals.some(signal => signal.level === 'red') ? 'red' : signals.some(signal => signal.level === 'yellow') ? 'yellow' : 'green';
  return {
    level,
    signals,
    pending: alarms.pending,
    history: {
      weight_kg: entry.weight_kg ?? null,
      glucose_mg_dl: entry.glucose_mg_dl ?? null,
      other_symptoms: entry.other_symptoms || [],
      free_text: entry.free_text || null,
    },
  };
}

function buildDailyRiskFeed(entries = [], { weeks = null } = {}) {
  return entries.map((entry) => ({
    entry_key: entry.entry_key,
    entry_date: entry.entry_date,
    version: entry.version,
    ...evaluateDailyEntry(entry, { weeks }),
  })).sort((a, b) => String(b.entry_date).localeCompare(String(a.entry_date)));
}

module.exports = { buildDailyRiskFeed, evaluateBloodPressure, evaluateDailyEntry };
