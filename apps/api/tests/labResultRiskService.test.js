/**
 * Testes unitários e de integração para o motor de risco de lab_results (E2-07, #100).
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  LAB_RISK_RULES_VERSION,
  evaluateGlucose,
  evaluateHemoglobin,
  evaluateLabResult,
  evaluateUrineProtein,
  syncLabResultRisk,
  deactivateLabResultAlerts,
} = require('../services/labResultRiskService');

test('Hemoglobina: identifica anemia grave (< 8 g/dL) como alerta crítico (red)', () => {
  const result = {
    analyte_id: 'hemoglobin',
    value: 7.4,
    unit: 'g/dL',
    observed_at: '2026-10-28',
    status: 'accepted',
  };
  const evalOutcome = evaluateLabResult(result);
  assert.equal(evalOutcome.evaluated, true);
  assert.equal(evalOutcome.severity, 'red');
  assert.equal(evalOutcome.ruleId, 'lab_hemoglobin_severe');
  assert.equal(evalOutcome.ruleVersion, LAB_RISK_RULES_VERSION);
  assert.match(evalOutcome.message, /anemia grave/i);
});

test('Hemoglobina: identifica anemia gestacional (8 <= Hb < 11 g/dL) como alerta de atenção (yellow)', () => {
  const result = {
    analyte_id: 'hemoglobin',
    value: '9,8',
    unit: 'g/dL',
    observed_at: '2026-10-28',
    status: 'accepted',
  };
  const evalOutcome = evaluateLabResult(result);
  assert.equal(evalOutcome.evaluated, true);
  assert.equal(evalOutcome.severity, 'yellow');
  assert.equal(evalOutcome.ruleId, 'lab_hemoglobin_attention');
  assert.match(evalOutcome.message, /abaixo do valor de refer[eê]ncia/i);
});

test('Hemoglobina: valor normal (>= 11 g/dL) sinaliza fechamento de alertas', () => {
  const result = {
    analyte_id: 'hemoglobin',
    value: 12.5,
    unit: 'g/dL',
    observed_at: '2026-10-28',
    status: 'accepted',
  };
  const evalOutcome = evaluateLabResult(result);
  assert.equal(evalOutcome.evaluated, true);
  assert.equal(evalOutcome.isNormal, true);
  assert.deepEqual(evalOutcome.closeRules, ['lab_hemoglobin_severe', 'lab_hemoglobin_attention']);
});

test('Hemoglobina: unidade incompatível não gera falso alerta clínico', () => {
  const result = {
    analyte_id: 'hemoglobin',
    value: 10,
    unit: 'mg/dL', // Incompatível com g/dL
    observed_at: '2026-10-28',
    status: 'accepted',
  };
  const evalOutcome = evaluateLabResult(result);
  assert.equal(evalOutcome.evaluated, false);
  assert.equal(evalOutcome.reason, 'incompatible_unit');
});

test('Glicemia de jejum: avalia limiar >= 92 mg/dL como atenção (yellow) e < 92 como normal', () => {
  const high = evaluateLabResult({
    analyte_id: 'glucose',
    exam_type: 'fasting',
    value: 95,
    unit: 'mg/dL',
    observed_at: '2026-10-28',
    status: 'accepted',
  });
  assert.equal(high.evaluated, true);
  assert.equal(high.severity, 'yellow');
  assert.equal(high.ruleId, 'lab_glucose_fasting');

  const normal = evaluateLabResult({
    analyte_id: 'glucose',
    exam_type: 'fasting',
    value: 85,
    unit: 'mg/dL',
    observed_at: '2026-10-28',
    status: 'accepted',
  });
  assert.equal(normal.evaluated, true);
  assert.equal(normal.isNormal, true);
  assert.deepEqual(normal.closeRules, ['lab_glucose_fasting']);
});

test('Glicemia casual: avalia limiar >= 200 mg/dL como atenção (yellow)', () => {
  const high = evaluateLabResult({
    analyte_id: 'glucose',
    exam_type: 'casual',
    value: 210,
    unit: 'mg/dL',
    observed_at: '2026-10-28',
    status: 'accepted',
  });
  assert.equal(high.evaluated, true);
  assert.equal(high.severity, 'yellow');
  assert.equal(high.ruleId, 'lab_glucose_casual');
});

test('Glicemia TOTG 75g: distingue cortes de 0h (>= 92), 1h (>= 180) e 2h (>= 153)', () => {
  const timepoint0h = evaluateLabResult({
    analyte_id: 'glucose',
    exam_type: 'ogtt75g',
    timepoint: '0h',
    value: 94,
    unit: 'mg/dL',
    observed_at: '2026-10-28',
    status: 'accepted',
  });
  assert.equal(timepoint0h.severity, 'yellow');
  assert.equal(timepoint0h.ruleId, 'lab_glucose_ogtt_0h');

  const timepoint1h = evaluateLabResult({
    analyte_id: 'glucose',
    exam_type: 'ogtt75g',
    timepoint: '1h',
    value: 185,
    unit: 'mg/dL',
    observed_at: '2026-10-28',
    status: 'accepted',
  });
  assert.equal(timepoint1h.severity, 'yellow');
  assert.equal(timepoint1h.ruleId, 'lab_glucose_ogtt_1h');

  const timepoint2h = evaluateLabResult({
    analyte_id: 'glucose',
    exam_type: 'ogtt75g',
    timepoint: '2h',
    value: 155,
    unit: 'mg/dL',
    observed_at: '2026-10-28',
    status: 'accepted',
  });
  assert.equal(timepoint2h.severity, 'yellow');
  assert.equal(timepoint2h.ruleId, 'lab_glucose_ogtt_2h');

  const timepoint2hNormal = evaluateLabResult({
    analyte_id: 'glucose',
    exam_type: 'ogtt75g',
    timepoint: '2h',
    value: 140,
    unit: 'mg/dL',
    observed_at: '2026-10-28',
    status: 'accepted',
  });
  assert.equal(timepoint2hNormal.isNormal, true);
  assert.deepEqual(timepoint2hNormal.closeRules, ['lab_glucose_ogtt_2h']);
});

test('Glicemia sem exam_type ou TOTG sem timepoint não é avaliada (dado insuficiente)', () => {
  const noType = evaluateLabResult({
    analyte_id: 'glucose',
    value: 100,
    unit: 'mg/dL',
    observed_at: '2026-10-28',
    status: 'accepted',
  });
  assert.equal(noType.evaluated, false);
  assert.equal(noType.reason, 'missing_exam_type');

  const totgNoTimepoint = evaluateLabResult({
    analyte_id: 'glucose',
    exam_type: 'ogtt75g',
    value: 100,
    unit: 'mg/dL',
    observed_at: '2026-10-28',
    status: 'accepted',
  });
  assert.equal(totgNoTimepoint.evaluated, false);
  assert.equal(totgNoTimepoint.reason, 'missing_or_invalid_timepoint');
});

test('Proteinúria: detecta reagente em fita qualitativa (+, reagente, 1+) e quantitativo (>= 30 mg/dL)', () => {
  const fitaPlus = evaluateLabResult({
    analyte_id: 'urine_protein',
    value: '1+',
    unit: null,
    observed_at: '2026-10-28',
    status: 'accepted',
  });
  assert.equal(fitaPlus.severity, 'yellow');
  assert.equal(fitaPlus.ruleId, 'lab_urine_protein_elevated');

  const fitaReagente = evaluateLabResult({
    analyte_id: 'urine_protein',
    value: 'reagente',
    unit: null,
    observed_at: '2026-10-28',
    status: 'accepted',
  });
  assert.equal(fitaReagente.severity, 'yellow');

  const quantitativo = evaluateLabResult({
    analyte_id: 'urine_protein',
    value: 45,
    unit: 'mg/dL',
    observed_at: '2026-10-28',
    status: 'accepted',
  });
  assert.equal(quantitativo.severity, 'yellow');

  const negativo = evaluateLabResult({
    analyte_id: 'urine_protein',
    value: 'negativo',
    unit: null,
    observed_at: '2026-10-28',
    status: 'accepted',
  });
  assert.equal(negativo.isNormal, true);
  assert.deepEqual(negativo.closeRules, ['lab_urine_protein_elevated']);
});

test('Status pendente ou rejeitado não dispara regras de risco', () => {
  const pending = evaluateLabResult({
    analyte_id: 'hemoglobin',
    value: 7.0,
    unit: 'g/dL',
    observed_at: '2026-10-28',
    status: 'pending',
  });
  assert.equal(pending.evaluated, false);
  assert.equal(pending.reason, 'not_clinically_usable');

  const rejected = evaluateLabResult({
    analyte_id: 'hemoglobin',
    value: 7.0,
    unit: 'g/dL',
    observed_at: '2026-10-28',
    status: 'rejected',
  });
  assert.equal(rejected.evaluated, false);
  assert.equal(rejected.reason, 'not_clinically_usable');
});

test('Persistência e idempotência com mock de banco: syncLabResultRisk grava alert_events e fecha ao normalizar', async () => {
  const events = [];
  let eventSeq = 1;

  const mockDb = {
    async query(sql, params) {
      if (sql.includes('SELECT id, weeks FROM pregnancies')) {
        return { rows: [{ id: 42, weeks: 24 }] };
      }
      if (sql.includes('SELECT * FROM alert_events')) {
        const found = events.find(
          (e) => e.pregnancy_id === params[0] && e.rule_id === params[1] && e.severity === params[2] && e.status === 'open'
        );
        return { rows: found ? [found] : [] };
      }
      if (sql.includes('INSERT INTO alert_events')) {
        const row = {
          id: eventSeq++,
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
        events.push(row);
        return { rows: [row] };
      }
      if (sql.includes('UPDATE alert_events') && sql.includes('last_seen_at')) {
        const target = events.find((e) => e.id === params[0]);
        if (target) {
          target.last_seen_at = new Date().toISOString();
          target.source_id = params[2];
        }
        return { rows: [target] };
      }
      if (sql.includes('UPDATE alert_events') && sql.includes('nova medida aceita e normal')) {
        const closed = [];
        for (const e of events) {
          if (e.pregnancy_id === params[0] && e.rule_id === params[1] && e.status === 'open') {
            e.status = 'closed';
            closed.push(e);
          }
        }
        return { rows: closed };
      }
      if (sql.includes('UPDATE alert_events') && sql.includes("source_type = 'lab_result'")) {
        const closed = [];
        for (const e of events) {
          if (e.source_id === String(params[0]) && e.status === 'open') {
            e.status = 'closed';
            closed.push(e);
          }
        }
        return { rows: closed };
      }
      return { rows: [] };
    },
  };

  // 1. Aceita Hb alterada (anemia) -> gera alerta
  const hbResult = {
    id: 101,
    pregnant_id: 10,
    analyte_id: 'hemoglobin',
    value: 9.5,
    unit: 'g/dL',
    observed_at: '2026-10-28',
    status: 'accepted',
  };

  const outcome1 = await syncLabResultRisk(mockDb, hbResult);
  assert.equal(outcome1.status, 'alert_created');
  assert.equal(events.length, 1);
  assert.equal(events[0].rule_id, 'lab_hemoglobin_attention');
  assert.equal(events[0].status, 'open');

  // 2. Mesma medição repetida/reenviada -> idempotência (não duplica, apenas atualiza)
  const outcome2 = await syncLabResultRisk(mockDb, hbResult);
  assert.equal(outcome2.created, false);
  assert.equal(events.length, 1);

  // 3. Nova medida normal de Hb (12.0) -> fecha o alerta aberto de anemia
  const hbNormal = {
    id: 102,
    pregnant_id: 10,
    analyte_id: 'hemoglobin',
    value: 12.0,
    unit: 'g/dL',
    observed_at: '2026-11-01',
    status: 'accepted',
  };
  const outcome3 = await syncLabResultRisk(mockDb, hbNormal);
  assert.equal(outcome3.status, 'normal');
  assert.equal(events[0].status, 'closed');

  // 4. Se um resultado que gerou alerta é reaberto ou rejeitado -> fecha o alerta
  const glucoseHigh = {
    id: 201,
    pregnant_id: 10,
    analyte_id: 'glucose',
    exam_type: 'fasting',
    value: 105,
    unit: 'mg/dL',
    observed_at: '2026-10-28',
    status: 'accepted',
  };
  await syncLabResultRisk(mockDb, glucoseHigh);
  assert.equal(events.some((e) => e.rule_id === 'lab_glucose_fasting' && e.status === 'open'), true);

  // Médico reabre o resultado para correção
  const reopenedGlucose = { ...glucoseHigh, status: 'pending' };
  const deactivateOutcome = await syncLabResultRisk(mockDb, reopenedGlucose);
  assert.equal(deactivateOutcome.status, 'deactivated');
  assert.equal(events.find((e) => e.rule_id === 'lab_glucose_fasting').status, 'closed');
});
