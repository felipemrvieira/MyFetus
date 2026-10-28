const ALARM_LABELS = Object.freeze({
  sangramento: 'Sangramento',
  perda_liquido: 'Perda de líquido',
  cefaleia_intensa: 'Dor de cabeça intensa',
  febre: 'Febre',
  contracoes: 'Contrações',
});

function evaluateBloodPressure(systolic, diastolic) {
  const high = Number(systolic);
  const low = Number(diastolic);
  if (!Number.isFinite(high) && !Number.isFinite(low)) return null;
  if (high >= 160 || low >= 110) return { code: 'blood_pressure_severe', level: 'red', message: 'Pressão arterial em faixa crítica.' };
  if (high >= 140 || low >= 90) return { code: 'blood_pressure_elevated', level: 'yellow', message: 'Pressão arterial em faixa de atenção.' };
  return null;
}

function evaluateDailyEntry(entry) {
  const signals = [];
  const alarmSymptoms = Array.isArray(entry.alarm_symptoms) ? entry.alarm_symptoms : [];
  for (const symptom of alarmSymptoms) {
    signals.push({ code: `alarm_${symptom}`, level: 'red', message: ALARM_LABELS[symptom] || 'Sintoma de alarme registrado.' });
  }
  if (entry.reduced_fetal_movements === true) signals.push({ code: 'reduced_fetal_movements', level: 'red', message: 'Relato de bebê mexendo menos.' });
  const pressure = evaluateBloodPressure(entry.systolic, entry.diastolic);
  if (pressure) signals.push(pressure);
  const level = signals.some(signal => signal.level === 'red') ? 'red' : signals.some(signal => signal.level === 'yellow') ? 'yellow' : 'green';
  return {
    level,
    signals,
    history: {
      weight_kg: entry.weight_kg ?? null,
      glucose_mg_dl: entry.glucose_mg_dl ?? null,
      other_symptoms: entry.other_symptoms || [],
      free_text: entry.free_text || null,
    },
  };
}

function buildDailyRiskFeed(entries = []) {
  return entries.map((entry) => ({
    entry_key: entry.entry_key,
    entry_date: entry.entry_date,
    version: entry.version,
    ...evaluateDailyEntry(entry),
  })).sort((a, b) => String(b.entry_date).localeCompare(String(a.entry_date)));
}

module.exports = { buildDailyRiskFeed, evaluateBloodPressure, evaluateDailyEntry };
