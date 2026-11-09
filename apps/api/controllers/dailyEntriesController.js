const client = require('../backend');
const cryptoService = require('../services/cryptoService');
const {
  DailyEntryValidationError,
  buildEntryKey,
  normalizePayload,
  serializeEntry,
  toEncryptedFields,
  validateId,
} = require('../services/dailyEntryService');
const { ensureCanAccessPregnancy } = require('../utils/clinicalAccess');
const { audit } = require('../services/auditService');
const { sendInternalError } = require('../utils/httpErrors');
const {
  buildDailyEntryRuleContext,
  validateDailyEntryByGestationalAge,
} = require('../services/dailyEntryRuleService');
const { buildDailyRiskFeed } = require('../services/dailyRiskFeedService');
const { buildAlarmAuditDetail, evaluateDailyAlarms } = require('../services/dailyAlarmRuleService');
const {
  autoCloseNormalAlert,
  dailyEntryAlerts,
  upsertAlertEvent,
} = require('../services/alertEventService');

function handleError(res, error) {
  if (error instanceof DailyEntryValidationError) {
    return res.status(400).json({ error: error.validationMessage });
  }
  if (error?.code === 'MOVEMENTS_NOT_APPLICABLE') {
    return res.status(400).json({ error: 'movimentos fetais so podem ser informados a partir de 28 semanas' });
  }
  return sendInternalError(res);
}

function encryptEntry(entry) {
  return cryptoService.encryptRecord(toEncryptedFields(entry), 'daily_entries');
}

async function syncDailyAlerts(entry, { pregnancyId, pregnantId, sourceId, weeks = null }) {
  const alerts = dailyEntryAlerts(entry, { pregnancyId, pregnantId, sourceId, weeks });
  const events = [];
  for (const alert of alerts) events.push((await upsertAlertEvent(client, alert)).event);
  if (!alerts.some(alert => alert.rule_id === 'daily_blood_pressure')) {
    await autoCloseNormalAlert(client, { pregnancyId, ruleId: 'daily_blood_pressure', severity: 'yellow' });
    await autoCloseNormalAlert(client, { pregnancyId, ruleId: 'daily_blood_pressure', severity: 'red' });
  }
  // Alarmes E3-07 não são fechados automaticamente: só o médico encerra, com justificativa.
  return events;
}

// E3-07: resposta imediata para a gestante. Não depende de push (E5-03) nem de IA.
function buildAlarmResponse(evaluation) {
  return {
    level: evaluation.level,
    catalog_version: evaluation.catalog_version,
    orientation: evaluation.orientation,
    triggered: evaluation.triggered.map(({ rule_id, version, severity }) => ({ rule_id, version, severity })),
    pending: evaluation.pending,
  };
}

function auditAlarm(req, { entryKey, pregnancyId, evaluation, events }) {
  if (evaluation.level === 'green') return;
  audit(req, {
    action: 'DAILY_ALARM_TRIGGERED',
    resource: 'daily_entries',
    resource_id: entryKey,
    detail: buildAlarmAuditDetail(evaluation, {
      pregnancyId,
      alertEventIds: events.map(event => event.id),
    }),
  });
}

async function findPregnancyWithWeeks(pregnancyId) {
  const result = await client.query(
    `SELECT id, pregnant_id, weeks, dum, ig_ultrassonografia
     FROM pregnancies WHERE id = $1`,
    [pregnancyId]
  );
  return result.rows[0]
    ? cryptoService.decryptRecord(result.rows[0], 'pregnancies')
    : null;
}

async function createDailyEntry(req, res) {
  try {
    const pregnancyId = validateId(req.body?.pregnancy_id, 'pregnancy_id');
    const pregnancy = await ensureCanAccessPregnancy(req, res, pregnancyId);
    if (!pregnancy) return;
    const currentPregnancy = await findPregnancyWithWeeks(pregnancyId);
    if (!currentPregnancy) return res.status(404).json({ error: 'Gestação não encontrada' });

    const ruleContext = buildDailyEntryRuleContext(currentPregnancy);
    const entry = validateDailyEntryByGestationalAge(
      normalizePayload(req.body, currentPregnancy.weeks),
      ruleContext
    );
    const encrypted = encryptEntry(entry);
    const entryKey = buildEntryKey();
    const result = await client.query(
      `INSERT INTO daily_entries (
        entry_key, pregnant_id, pregnancy_id, entry_date, timezone,
        alarm_symptoms, other_symptoms, free_text, systolic, diastolic,
        weight_kg, glucose_mg_dl, reduced_fetal_movements, temperature_c,
        created_by_user_id, encryption_key_version
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      RETURNING *`,
      [
        entryKey,
        currentPregnancy.pregnant_id,
        pregnancyId,
        entry.entry_date,
        entry.timezone,
        encrypted.alarm_symptoms,
        encrypted.other_symptoms,
        encrypted.free_text,
        encrypted.systolic,
        encrypted.diastolic,
        encrypted.weight_kg,
        encrypted.glucose_mg_dl,
        encrypted.reduced_fetal_movements,
        encrypted.temperature_c,
        req.user.id,
        cryptoService.getCurrentVersion(),
      ]
    );
    const created = cryptoService.decryptRecord(result.rows[0], 'daily_entries');
    const createdSerialized = serializeEntry(created);
    const weeks = ruleContext.weeks;
    const events = await syncDailyAlerts(createdSerialized, {
      pregnancyId,
      pregnantId: currentPregnancy.pregnant_id,
      sourceId: entryKey,
      weeks,
    });
    const evaluation = evaluateDailyAlarms(createdSerialized, { weeks });
    const alarm = buildAlarmResponse(evaluation);
    auditAlarm(req, { entryKey, pregnancyId, evaluation, events });
    audit(req, {
      action: 'DAILY_ENTRY_CREATED',
      resource: 'daily_entries',
      resource_id: entryKey,
      detail: { pregnancy_id: pregnancyId, version: 1 },
    });
    return res.status(201).json({
      ...createdSerialized,
      gestational_rule_context: ruleContext,
      alarm,
    });
  } catch (error) {
    return handleError(res, error);
  }
}

async function listDailyEntries(req, res) {
  try {
    const pregnancyId = validateId(req.params.pregnancyId, 'pregnancy_id');
    if (!(await ensureCanAccessPregnancy(req, res, pregnancyId))) return;
    const result = await client.query(
      `SELECT * FROM daily_entries
       WHERE pregnancy_id = $1 AND is_current = TRUE
       ORDER BY entry_date DESC, id DESC
       LIMIT 500`,
      [pregnancyId]
    );
    const entries = result.rows.map((row) => serializeEntry(
      cryptoService.decryptRecord(row, 'daily_entries')
    ));
    return res.json(entries);
  } catch (error) {
    return handleError(res, error);
  }
}

async function listDailyRiskFeed(req, res) {
  try {
    const pregnancyId = validateId(req.params.pregnancyId, 'pregnancy_id');
    if (!(await ensureCanAccessPregnancy(req, res, pregnancyId))) return;
    const pregnancy = await findPregnancyWithWeeks(pregnancyId);
    const { weeks } = buildDailyEntryRuleContext(pregnancy || {});
    const result = await client.query(
      `SELECT * FROM daily_entries
       WHERE pregnancy_id = $1 AND is_current = TRUE
       ORDER BY entry_date DESC, id DESC
       LIMIT 500`,
      [pregnancyId]
    );
    const entries = result.rows.map((row) => serializeEntry(
      cryptoService.decryptRecord(row, 'daily_entries')
    ));
    audit(req, {
      action: 'DAILY_RISK_FEED_ACCESSED',
      resource: 'daily_entries',
      resource_id: String(pregnancyId),
      detail: { count: entries.length },
    });
    return res.json({
      pregnancy_id: pregnancyId,
      entries: buildDailyRiskFeed(entries, { weeks }),
      policy: {
        evaluated_fields: ['alarm_symptoms', 'reduced_fetal_movements', 'systolic', 'diastolic', 'temperature_c'],
        history_only_fields: ['weight_kg', 'glucose_mg_dl', 'other_symptoms', 'free_text'],
      },
    });
  } catch (error) {
    return handleError(res, error);
  }
}

async function updateDailyEntry(req, res) {
  const entryKey = String(req.params.entryKey || '').trim();
  if (!entryKey || entryKey.length > 80) return res.status(400).json({ error: 'entry_key invalido' });
  const db = client;
  try {
    await db.query('BEGIN');
    const currentResult = await db.query(
      `SELECT * FROM daily_entries
       WHERE entry_key = $1 AND is_current = TRUE
       FOR UPDATE`,
      [entryKey]
    );
    const currentRow = currentResult.rows[0];
    if (!currentRow) {
      await db.query('ROLLBACK');
      return res.status(404).json({ error: 'Entrada do diario nao encontrada' });
    }
    if (!(await ensureCanAccessPregnancy(req, res, currentRow.pregnancy_id))) {
      await db.query('ROLLBACK');
      return;
    }
    const pregnancy = await findPregnancyWithWeeks(currentRow.pregnancy_id);
    const current = cryptoService.decryptRecord(currentRow, 'daily_entries');
    const patch = { ...serializeEntry(current), ...req.body, entry_date: req.body?.entry_date || current.entry_date };
    const ruleContext = buildDailyEntryRuleContext(pregnancy || {});
    const entry = validateDailyEntryByGestationalAge(
      normalizePayload(patch, pregnancy?.weeks),
      ruleContext
    );
    const encrypted = encryptEntry(entry);
    await db.query(
      'UPDATE daily_entries SET is_current = FALSE, updated_at = CURRENT_TIMESTAMP WHERE id = $1',
      [currentRow.id]
    );
    const result = await db.query(
      `INSERT INTO daily_entries (
        entry_key, pregnant_id, pregnancy_id, entry_date, timezone, version,
        previous_version_id, alarm_symptoms, other_symptoms, free_text,
        systolic, diastolic, weight_kg, glucose_mg_dl, reduced_fetal_movements,
        temperature_c, created_by_user_id, encryption_key_version
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
      RETURNING *`,
      [
        entryKey,
        currentRow.pregnant_id,
        currentRow.pregnancy_id,
        entry.entry_date,
        entry.timezone,
        Number(currentRow.version) + 1,
        currentRow.id,
        encrypted.alarm_symptoms,
        encrypted.other_symptoms,
        encrypted.free_text,
        encrypted.systolic,
        encrypted.diastolic,
        encrypted.weight_kg,
        encrypted.glucose_mg_dl,
        encrypted.reduced_fetal_movements,
        encrypted.temperature_c,
        req.user.id,
        cryptoService.getCurrentVersion(),
      ]
    );
    await db.query('COMMIT');
    const updated = cryptoService.decryptRecord(result.rows[0], 'daily_entries');
    const updatedSerialized = serializeEntry(updated);
    const events = await syncDailyAlerts(updatedSerialized, {
      pregnancyId: currentRow.pregnancy_id,
      pregnantId: currentRow.pregnant_id,
      sourceId: entryKey,
      weeks: ruleContext.weeks,
    });
    const evaluation = evaluateDailyAlarms(updatedSerialized, { weeks: ruleContext.weeks });
    const alarm = buildAlarmResponse(evaluation);
    auditAlarm(req, { entryKey, pregnancyId: currentRow.pregnancy_id, evaluation, events });
    audit(req, {
      action: 'DAILY_ENTRY_UPDATED',
      resource: 'daily_entries',
      resource_id: entryKey,
      detail: { pregnancy_id: currentRow.pregnancy_id, version: updated.version },
    });
    return res.json({
      ...updatedSerialized,
      gestational_rule_context: ruleContext,
      alarm,
    });
  } catch (error) {
    try { await db.query('ROLLBACK'); } catch {}
    return handleError(res, error);
  }
}

module.exports = {
  createDailyEntry,
  listDailyEntries,
  listDailyRiskFeed,
  updateDailyEntry,
};
