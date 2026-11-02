/**
 * Testes de integração E2E: Valores aceitos em lab_results disparam regras de risco (E2-07, #100).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const cryptoService = require('../services/cryptoService');
const { createLabResultService } = require('../services/labResultService');
const { syncLabResultRisk } = require('../services/labResultRiskService');

test('Fluxo completo: aceitar hemoglobina crítica dispara alerta vermelho, que é fechado ao corrigir para valor normal', async () => {
  // Simulador de banco com tabelas pregnancies, alert_events e lab_results
  let alertSeq = 1;
  const alertEvents = [];
  const pregnancies = [{ id: 1, pregnant_id: 10, weeks: 26 }];

  const db = {
    async query(sql, params) {
      if (sql.includes('SELECT id, weeks FROM pregnancies')) {
        return { rows: pregnancies.filter((p) => p.pregnant_id === params[0]) };
      }
      if (sql.includes('SELECT * FROM alert_events WHERE pregnancy_id = $1 AND rule_id = $2 AND severity = $3')) {
        const found = alertEvents.find(
          (e) => e.pregnancy_id === params[0] && e.rule_id === params[1] && e.severity === params[2] && e.status === 'open'
        );
        return { rows: found ? [found] : [] };
      }
      if (sql.includes('INSERT INTO alert_events')) {
        const row = {
          id: alertSeq++,
          alert_key: params[0],
          pregnancy_id: params[1],
          pregnant_id: params[2],
          rule_id: params[3],
          severity: params[4],
          source_type: params[5],
          source_id: params[6],
          message: params[7],
          signal_codes: JSON.parse(params[8]),
          status: 'open',
          first_seen_at: new Date().toISOString(),
          last_seen_at: new Date().toISOString(),
        };
        alertEvents.push(row);
        return { rows: [row] };
      }
      if (sql.includes('UPDATE alert_events') && sql.includes('nova medida aceita e normal')) {
        const closed = [];
        for (const e of alertEvents) {
          if (e.pregnancy_id === params[0] && e.rule_id === params[1] && ['open', 'acknowledged'].includes(e.status)) {
            e.status = 'closed';
            e.close_reason = 'nova medida aceita e normal';
            closed.push(e);
          }
        }
        return { rows: closed };
      }
      return { rows: [] };
    },
  };

  // 1. Aceitar Hemoglobina 7.2 g/dL (anemia grave)
  const severeHb = {
    id: 50,
    pregnant_id: 10,
    document_id: 3,
    analyte_id: 'hemoglobin',
    value: 7.2,
    unit: 'g/dL',
    observed_at: '2026-10-29',
    status: 'accepted',
    version: 2,
  };

  const outcomeSevere = await syncLabResultRisk(db, severeHb, { userId: 5 });
  assert.equal(outcomeSevere.status, 'alert_created');
  assert.equal(outcomeSevere.severity, 'red');
  assert.equal(outcomeSevere.ruleId, 'lab_hemoglobin_severe');

  // Confere alerta gravado
  const activeAlerts = alertEvents.filter((e) => e.status === 'open');
  assert.equal(activeAlerts.length, 1);
  assert.equal(activeAlerts[0].severity, 'red');
  assert.equal(activeAlerts[0].rule_id, 'lab_hemoglobin_severe');
  assert.match(activeAlerts[0].message, /anemia grave/i);

  // 2. Médico corrige o resultado para valor normal (11.5 g/dL)
  const correctedHb = {
    id: 50,
    pregnant_id: 10,
    document_id: 3,
    analyte_id: 'hemoglobin',
    value: 11.5,
    unit: 'g/dL',
    observed_at: '2026-10-29',
    status: 'corrected',
    version: 3,
  };

  const outcomeCorrected = await syncLabResultRisk(db, correctedHb, { userId: 5 });
  assert.equal(outcomeCorrected.status, 'normal');

  // Confere que o alerta crítico anterior foi fechado automaticamente
  const closedAlert = alertEvents.find((e) => e.rule_id === 'lab_hemoglobin_severe');
  assert.equal(closedAlert.status, 'closed');
  assert.equal(closedAlert.close_reason, 'nova medida aceita e normal');
});
