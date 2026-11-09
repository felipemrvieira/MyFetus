const test = require('node:test');
const assert = require('node:assert/strict');

const {
  AlertEventValidationError,
  acknowledgeAlert,
  dailyEntryAlerts,
  listAlertHistory,
  validateAlertInput,
} = require('../services/alertEventService');

function createAlertDb() {
  const event = {
    id: 7,
    pregnancy_id: 10,
    pregnant_id: 20,
    rule_id: 'blood_pressure_severe',
    severity: 'red',
    status: 'open',
    source_type: 'risk_engine',
    source_id: 'measurement-1',
    message: 'Alerta de teste',
    signal_codes: ['blood_pressure_severe'],
    first_seen_at: '2026-11-09T10:00:00Z',
    last_seen_at: '2026-11-09T10:00:00Z',
  };
  const history = [];

  return {
    event,
    history,
    async query(sql, params = []) {
      if (sql.startsWith('SELECT * FROM alert_events')) {
        return { rows: event.status === 'closed' ? [] : [event] };
      }
      if (sql.includes("SET status = 'acknowledged'")) {
        event.status = 'acknowledged';
        event.acknowledged_by_user_id = params[1];
        event.acknowledged_at = '2026-11-09T10:05:00Z';
        return { rows: [event] };
      }
      if (sql.includes('INSERT INTO alert_event_history')) {
        const row = {
          id: history.length + 1,
          alert_event_id: params[0],
          action: params[1],
          previous_status: params[2],
          status: params[3],
          actor_id: params[4],
          justification: params[5],
          created_at: '2026-11-09T10:05:00Z',
        };
        history.push(row);
        return { rows: [row] };
      }
      if (sql.includes('FROM alert_event_history')) {
        return { rows: history.filter(row => row.alert_event_id === params[0]) };
      }
      throw new Error(`SQL inesperado no fake: ${sql}`);
    },
  };
}

test('diário gera alerta urgente para alarme e pressão crítica', () => {
  const alerts = dailyEntryAlerts({
    alarm_symptoms: ['sangramento'],
    reduced_fetal_movements: true,
    systolic: 165,
    diastolic: 90,
  }, { pregnancyId: 10, pregnantId: 20, sourceId: 'entry-1' });
  assert.deepEqual(alerts.map(alert => alert.rule_id), [
    'daily_sangramento',
    'daily_reduced_fetal_movements',
    'daily_blood_pressure',
  ]);
  assert.ok(alerts.every(alert => alert.severity === 'red'));
});

test('pressão de atenção não é confundida com urgência', () => {
  const alerts = dailyEntryAlerts({ systolic: 145, diastolic: 90 }, {
    pregnancyId: 10, pregnantId: 20, sourceId: 'entry-2',
  });
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].severity, 'yellow');
});

test('valida contrato mínimo de evento', () => {
  assert.throws(
    () => validateAlertInput({ pregnancy_id: 1, pregnant_id: 2, rule_id: 'x', severity: 'blue', source_type: 'daily_entry', message: 'x' }),
    error => error instanceof AlertEventValidationError
  );
});

test('reconhecer exige justificativa e grava histórico imutável da decisão', async () => {
  const db = createAlertDb();

  await assert.rejects(
    () => acknowledgeAlert(db, 7, 99, '  '),
    error => error instanceof AlertEventValidationError
      && error.validationMessage === 'justificativa obrigatoria para reconhecer alerta'
  );

  const result = await acknowledgeAlert(db, 7, 99, 'Medida revisada pelo médico.');
  assert.equal(result.status, 'acknowledged');
  assert.equal(db.history.length, 1);
  assert.deepEqual(await listAlertHistory(db, 7), [
    {
      id: 1,
      alert_event_id: 7,
      action: 'acknowledged',
      previous_status: 'open',
      status: 'acknowledged',
      actor_id: 99,
      justification: 'Medida revisada pelo médico.',
      created_at: '2026-11-09T10:05:00Z',
    },
  ]);
});

test('reconhecimento repetido é idempotente e não duplica histórico', async () => {
  const db = createAlertDb();
  await acknowledgeAlert(db, 7, 99, 'Primeira revisão.');

  const result = await acknowledgeAlert(db, 7, 100, 'Segunda tentativa.');
  assert.equal(result.status, 'acknowledged');
  assert.equal(db.history.length, 1);
});
