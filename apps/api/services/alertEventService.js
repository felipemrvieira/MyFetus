const { randomUUID } = require('node:crypto');

const SEVERITIES = new Set(['yellow', 'red']);
const SOURCES = new Set(['daily_entry', 'lab_result', 'risk_engine']);

class AlertEventValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AlertEventValidationError';
    this.validationMessage = message;
  }
}

function validateAlertInput(alert) {
  if (!alert || !Number.isInteger(Number(alert.pregnancy_id)) || Number(alert.pregnancy_id) <= 0) {
    throw new AlertEventValidationError('pregnancy_id invalido');
  }
  if (!Number.isInteger(Number(alert.pregnant_id)) || Number(alert.pregnant_id) <= 0) {
    throw new AlertEventValidationError('pregnant_id invalido');
  }
  if (!alert.rule_id || !SEVERITIES.has(alert.severity) || !SOURCES.has(alert.source_type)) {
    throw new AlertEventValidationError('alerta invalido');
  }
  if (!alert.message || String(alert.message).length > 500) {
    throw new AlertEventValidationError('mensagem de alerta invalida');
  }
  return true;
}

function serializeAlertEvent(row) {
  return {
    id: row.id,
    alert_key: row.alert_key,
    pregnancy_id: row.pregnancy_id,
    pregnant_id: row.pregnant_id,
    rule_id: row.rule_id,
    severity: row.severity,
    status: row.status,
    source_type: row.source_type,
    source_id: row.source_id || null,
    message: row.message,
    signal_codes: Array.isArray(row.signal_codes) ? row.signal_codes : [],
    first_seen_at: row.first_seen_at,
    last_seen_at: row.last_seen_at,
    acknowledged_at: row.acknowledged_at || null,
    closed_at: row.closed_at || null,
    close_reason: row.close_reason || null,
  };
}

function serializeAlertEventHistory(row) {
  return {
    id: row.id,
    alert_event_id: row.alert_event_id,
    action: row.action,
    previous_status: row.previous_status || null,
    status: row.status,
    actor_id: row.actor_id || null,
    justification: row.justification || null,
    created_at: row.created_at,
  };
}

function validateJustification(value, message) {
  const justification = String(value || '').trim();
  if (justification.length < 3 || justification.length > 1000) {
    throw new AlertEventValidationError(message);
  }
  return justification;
}

async function withAlertTransaction(db, callback) {
  const connection = typeof db.connect === 'function' ? await db.connect() : db;
  const ownsConnection = connection !== db;
  try {
    if (ownsConnection) await connection.query('BEGIN');
    const result = await callback(connection);
    if (ownsConnection) await connection.query('COMMIT');
    return result;
  } catch (error) {
    if (ownsConnection) await connection.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    if (ownsConnection) connection.release();
  }
}

async function recordAlertHistory(db, {
  alertEventId,
  action,
  previousStatus,
  status,
  actorId,
  justification = null,
}) {
  const result = await db.query(
    `INSERT INTO alert_event_history (
       alert_event_id, action, previous_status, status, actor_id, justification
     ) VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [alertEventId, action, previousStatus || null, status, actorId || null, justification || null]
  );
  return serializeAlertEventHistory(result.rows[0]);
}

async function upsertAlertEvent(db, alert) {
  validateAlertInput(alert);
  const current = await db.query(
    `SELECT * FROM alert_events
     WHERE pregnancy_id = $1 AND rule_id = $2 AND severity = $3
       AND status IN ('open', 'acknowledged')
     ORDER BY id DESC LIMIT 1`,
    [alert.pregnancy_id, alert.rule_id, alert.severity]
  );
  if (current.rows[0]) {
    const result = await db.query(
      `UPDATE alert_events
       SET last_seen_at = CURRENT_TIMESTAMP,
           source_type = $2, source_id = $3, message = $4,
           signal_codes = $5::jsonb, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1
       RETURNING *`,
      [current.rows[0].id, alert.source_type, alert.source_id || null, alert.message, JSON.stringify(alert.signal_codes || [])]
    );
    return { event: serializeAlertEvent(result.rows[0]), created: false };
  }
  const result = await db.query(
    `INSERT INTO alert_events (
       alert_key, pregnancy_id, pregnant_id, rule_id, severity, source_type,
       source_id, message, signal_codes
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
     RETURNING *`,
    [randomUUID(), alert.pregnancy_id, alert.pregnant_id, alert.rule_id, alert.severity,
      alert.source_type, alert.source_id || null, alert.message, JSON.stringify(alert.signal_codes || [])]
  );
  return { event: serializeAlertEvent(result.rows[0]), created: true };
}

async function acknowledgeAlert(db, alertId, userId, justification) {
  const reason = validateJustification(justification, 'justificativa obrigatoria para reconhecer alerta');
  return withAlertTransaction(db, async (connection) => {
    const current = await connection.query(
      'SELECT * FROM alert_events WHERE id = $1 AND status IN (\'open\', \'acknowledged\') FOR UPDATE',
      [alertId]
    );
    if (!current.rows[0]) return null;
    if (current.rows[0].status === 'acknowledged') return serializeAlertEvent(current.rows[0]);

    const result = await connection.query(
      `UPDATE alert_events
       SET status = 'acknowledged',
           acknowledged_at = CURRENT_TIMESTAMP,
           acknowledged_by_user_id = $2,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND status = 'open'
       RETURNING *`,
      [alertId, userId]
    );
    if (!result.rows[0]) return null;
    await recordAlertHistory(connection, {
      alertEventId: result.rows[0].id,
      action: 'acknowledged',
      previousStatus: 'open',
      status: 'acknowledged',
      actorId: userId,
      justification: reason,
    });
    return serializeAlertEvent(result.rows[0]);
  });
}

async function closeAlert(db, alertId, userId, justification) {
  const reason = validateJustification(justification, 'justificativa obrigatoria para encerrar alerta');
  return withAlertTransaction(db, async (connection) => {
    const current = await connection.query(
      'SELECT * FROM alert_events WHERE id = $1 AND status IN (\'open\', \'acknowledged\') FOR UPDATE',
      [alertId]
    );
    if (!current.rows[0]) return null;

    const result = await connection.query(
      `UPDATE alert_events
       SET status = 'closed', closed_at = CURRENT_TIMESTAMP,
           closed_by_user_id = $2, close_reason = $3, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND status IN ('open', 'acknowledged')
       RETURNING *`,
      [alertId, userId, reason]
    );
    if (!result.rows[0]) return null;
    await recordAlertHistory(connection, {
      alertEventId: result.rows[0].id,
      action: 'closed',
      previousStatus: current.rows[0].status,
      status: 'closed',
      actorId: userId,
      justification: reason,
    });
    return serializeAlertEvent(result.rows[0]);
  });
}

async function listAlertHistory(db, alertId) {
  const result = await db.query(
    `SELECT id, alert_event_id, action, previous_status, status,
            actor_id, justification, created_at
       FROM alert_event_history
      WHERE alert_event_id = $1
      ORDER BY created_at ASC, id ASC`,
    [alertId]
  );
  return result.rows.map(serializeAlertEventHistory);
}

async function autoCloseNormalAlert(db, { pregnancyId, ruleId, severity = 'yellow' }) {
  const result = await db.query(
    `UPDATE alert_events
     SET status = 'closed', closed_at = CURRENT_TIMESTAMP,
         close_reason = 'nova medida aceita e normal', updated_at = CURRENT_TIMESTAMP
     WHERE pregnancy_id = $1 AND rule_id = $2 AND severity = $3
       AND status IN ('open', 'acknowledged')
       AND (severity = 'yellow' OR acknowledged_at IS NOT NULL)
     RETURNING *`,
    [pregnancyId, ruleId, severity]
  );
  return result.rows.map(serializeAlertEvent);
}

function dailyEntryAlerts(entry, { pregnancyId, pregnantId, sourceId }) {
  const alerts = [];
  const symptoms = Array.isArray(entry.alarm_symptoms) ? entry.alarm_symptoms : [];
  for (const symptom of symptoms) {
    alerts.push({
      pregnancy_id: pregnancyId, pregnant_id: pregnantId,
      rule_id: `daily_${symptom}`, severity: 'red', source_type: 'daily_entry', source_id: sourceId,
      message: 'Isso pode ser um sinal de alarme. Procure agora a maternidade ou um serviço de urgência, ou ligue 192 (SAMU).',
      signal_codes: [symptom],
    });
  }
  if (entry.reduced_fetal_movements === true) {
    alerts.push({
      pregnancy_id: pregnancyId, pregnant_id: pregnantId,
      rule_id: 'daily_reduced_fetal_movements', severity: 'red', source_type: 'daily_entry', source_id: sourceId,
      message: 'Isso pode ser um sinal de alarme. Procure agora a maternidade ou um serviço de urgência, ou ligue 192 (SAMU).',
      signal_codes: ['reduced_fetal_movements'],
    });
  }
  if (Number(entry.systolic) >= 160 || Number(entry.diastolic) >= 110) {
    alerts.push({
      pregnancy_id: pregnancyId, pregnant_id: pregnantId,
      rule_id: 'daily_blood_pressure', severity: 'red', source_type: 'daily_entry', source_id: sourceId,
      message: 'Isso pode ser um sinal de alarme. Procure agora a maternidade ou um serviço de urgência, ou ligue 192 (SAMU).',
      signal_codes: ['blood_pressure_severe'],
    });
  } else if (Number(entry.systolic) >= 140 || Number(entry.diastolic) >= 90) {
    alerts.push({
      pregnancy_id: pregnancyId, pregnant_id: pregnantId,
      rule_id: 'daily_blood_pressure', severity: 'yellow', source_type: 'daily_entry', source_id: sourceId,
      message: 'Pressão arterial em faixa de atenção. Repita a aferição em repouso e fale com a equipe de saúde.',
      signal_codes: ['blood_pressure_elevated'],
    });
  }
  return alerts;
}

module.exports = {
  AlertEventValidationError,
  acknowledgeAlert,
  autoCloseNormalAlert,
  closeAlert,
  dailyEntryAlerts,
  listAlertHistory,
  recordAlertHistory,
  serializeAlertEvent,
  serializeAlertEventHistory,
  upsertAlertEvent,
  validateAlertInput,
  validateJustification,
};
