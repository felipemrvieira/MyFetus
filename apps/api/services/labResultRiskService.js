/**
 * Motor de avaliação de risco para resultados laboratoriais revisados (E2-07, #100).
 *
 * Consome apenas resultados com status 'accepted' ou 'corrected' (clinicamente utilizáveis),
 * avaliando as regras de Hemoglobina (Hb), Glicemia e Proteinúria.
 *
 * Gera alertas idempotentes na tabela alert_events e fecha alertas abertos quando
 * uma medida normal subsequente é aceita ou quando o resultado é reaberto/rejeitado.
 */

const { upsertAlertEvent, autoCloseNormalAlert } = require('./alertEventService');

const LAB_RISK_RULES_VERSION = '1.0.0';

const CLINICALLY_USABLE_STATUSES = new Set(['accepted', 'corrected']);

const UNIT_ALIASES = {
  g_dl: new Set(['g/dl', 'g/100ml']),
  mg_dl: new Set(['mg/dl', 'mg/100ml']),
  mg_l: new Set(['mg/l']),
};

function normalizeUnit(unit) {
  if (!unit || typeof unit !== 'string') return null;
  const cleaned = unit.trim().toLowerCase().replace(/\s+/g, '');
  for (const [canonical, aliases] of Object.entries(UNIT_ALIASES)) {
    if (aliases.has(cleaned)) return canonical;
  }
  return cleaned;
}

function parseNumericValue(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const normalized = String(value).trim().replace(',', '.');
  const num = Number(normalized);
  return Number.isFinite(num) ? num : null;
}

/**
 * Avalia regras de Hemoglobina (Hb)
 * Diretrizes MS 2012 / MS 2022:
 * - Hb < 8.0 g/dL: Vermelho (crítico - anemia grave na gestação)
 * - 8.0 <= Hb < 11.0 g/dL: Amarelo (atenção - anemia gestacional)
 * - Hb >= 11.0 g/dL: Verde (normal)
 */
function evaluateHemoglobin(result) {
  const normUnit = normalizeUnit(result.unit);
  const numeric = parseNumericValue(result.value);

  if (normUnit !== 'g_dl') {
    return {
      evaluated: false,
      reason: normUnit ? 'incompatible_unit' : 'missing_unit',
      analyteId: 'hemoglobin',
    };
  }

  if (numeric === null) {
    return {
      evaluated: false,
      reason: 'missing_numeric_value',
      analyteId: 'hemoglobin',
    };
  }

  if (numeric < 8.0) {
    return {
      evaluated: true,
      analyteId: 'hemoglobin',
      ruleId: 'lab_hemoglobin_severe',
      severity: 'red',
      level: 'critical_low',
      signalCodes: ['hemoglobin_severe_anemia', 'anemia_hb_under_8'],
      message: 'Hemoglobina < 8,0 g/dL (anemia grave na gestação). Encaminhar prontamente para avaliação obstétrica / maternidade de alto risco.',
      ruleVersion: LAB_RISK_RULES_VERSION,
    };
  }

  if (numeric < 11.0) {
    return {
      evaluated: true,
      analyteId: 'hemoglobin',
      ruleId: 'lab_hemoglobin_attention',
      severity: 'yellow',
      level: 'low',
      signalCodes: ['hemoglobin_attention_anemia', 'anemia_hb_under_11'],
      message: 'Hemoglobina abaixo do valor de referência (Hb < 11,0 g/dL). Avaliar investigação de anemia gestacional e suplementação de ferro.',
      ruleVersion: LAB_RISK_RULES_VERSION,
    };
  }

  // Normal: Hb >= 11.0 g/dL
  return {
    evaluated: true,
    analyteId: 'hemoglobin',
    isNormal: true,
    closeRules: ['lab_hemoglobin_severe', 'lab_hemoglobin_attention'],
    ruleVersion: LAB_RISK_RULES_VERSION,
  };
}

/**
 * Avalia regras de Glicemia
 * Diretrizes MS 2022 / docs/regras-de-risco.md:
 * - Jejum (fasting): >= 92 mg/dL -> Amarelo
 * - Casual (casual): >= 200 mg/dL -> Amarelo
 * - TOTG 75 g (ogtt75g):
 *    - 0h (jejum): >= 92 mg/dL -> Amarelo
 *    - 1h: >= 180 mg/dL -> Amarelo
 *    - 2h: >= 153 mg/dL -> Amarelo
 */
function evaluateGlucose(result) {
  const normUnit = normalizeUnit(result.unit);
  const numeric = parseNumericValue(result.value);

  if (normUnit !== 'mg_dl') {
    return {
      evaluated: false,
      reason: normUnit ? 'incompatible_unit' : 'missing_unit',
      analyteId: 'glucose',
    };
  }

  if (numeric === null) {
    return {
      evaluated: false,
      reason: 'missing_numeric_value',
      analyteId: 'glucose',
    };
  }

  const examType = result.exam_type;
  if (!examType) {
    return {
      evaluated: false,
      reason: 'missing_exam_type',
      analyteId: 'glucose',
    };
  }

  if (examType === 'fasting') {
    if (numeric >= 92) {
      return {
        evaluated: true,
        analyteId: 'glucose',
        ruleId: 'lab_glucose_fasting',
        severity: 'yellow',
        level: 'high',
        signalCodes: ['fasting_glucose_elevated'],
        message: 'Glicemia de jejum em faixa de atenção (≥ 92 mg/dL). Registrar o resultado e manter acompanhamento profissional.',
        ruleVersion: LAB_RISK_RULES_VERSION,
      };
    }
    return {
      evaluated: true,
      analyteId: 'glucose',
      isNormal: true,
      closeRules: ['lab_glucose_fasting'],
      ruleVersion: LAB_RISK_RULES_VERSION,
    };
  }

  if (examType === 'casual') {
    if (numeric >= 200) {
      return {
        evaluated: true,
        analyteId: 'glucose',
        ruleId: 'lab_glucose_casual',
        severity: 'yellow',
        level: 'high',
        signalCodes: ['casual_glucose_elevated'],
        message: 'Glicemia casual em faixa de atenção (≥ 200 mg/dL). Registrar o tipo de exame e manter acompanhamento profissional.',
        ruleVersion: LAB_RISK_RULES_VERSION,
      };
    }
    return {
      evaluated: true,
      analyteId: 'glucose',
      isNormal: true,
      closeRules: ['lab_glucose_casual'],
      ruleVersion: LAB_RISK_RULES_VERSION,
    };
  }

  if (examType === 'ogtt75g') {
    const timepoint = result.timepoint;
    const thresholds = {
      '0h': 92,
      '1h': 180,
      '2h': 153,
    };

    if (!timepoint || !thresholds[timepoint]) {
      return {
        evaluated: false,
        reason: 'missing_or_invalid_timepoint',
        analyteId: 'glucose',
      };
    }

    const cut = thresholds[timepoint];
    const ruleId = `lab_glucose_ogtt_${timepoint}`;
    if (numeric >= cut) {
      return {
        evaluated: true,
        analyteId: 'glucose',
        ruleId,
        severity: 'yellow',
        level: 'high',
        signalCodes: [`ogtt75g_${timepoint}_elevated`],
        message: `TOTG 75 g (${timepoint}) em faixa de atenção (≥ ${cut} mg/dL). Manter acompanhamento profissional.`,
        ruleVersion: LAB_RISK_RULES_VERSION,
      };
    }
    return {
      evaluated: true,
      analyteId: 'glucose',
      isNormal: true,
      closeRules: [ruleId],
      ruleVersion: LAB_RISK_RULES_VERSION,
    };
  }

  return {
    evaluated: false,
    reason: 'unsupported_exam_type',
    analyteId: 'glucose',
  };
}

/**
 * Avalia regras de Proteinúria
 * Identifica fitas qualitativas (+, ++, +++, reagente, positivo)
 * ou valores quantitativos >= 30 mg/dL (ou >= 300 mg/L).
 */
function evaluateUrineProtein(result) {
  const normUnit = normalizeUnit(result.unit);
  const numeric = parseNumericValue(result.value);
  const textVal = String(result.value || '').trim().toLowerCase();

  // Caso quantitativo numérico
  if (numeric !== null) {
    if (normUnit === 'mg_dl' && numeric >= 30) {
      return {
        evaluated: true,
        analyteId: 'urine_protein',
        ruleId: 'lab_urine_protein_elevated',
        severity: 'yellow',
        level: 'high',
        signalCodes: ['proteinuria_detected', 'proteinuria_quantitative_high'],
        message: 'Proteinúria em faixa de atenção (≥ 30 mg/dL). Investigar pressão arterial e sinais de pré-eclâmpsia.',
        ruleVersion: LAB_RISK_RULES_VERSION,
      };
    }
    if (normUnit === 'mg_l' && numeric >= 300) {
      return {
        evaluated: true,
        analyteId: 'urine_protein',
        ruleId: 'lab_urine_protein_elevated',
        severity: 'yellow',
        level: 'high',
        signalCodes: ['proteinuria_detected', 'proteinuria_quantitative_high'],
        message: 'Proteinúria em faixa de atenção (≥ 300 mg/L). Investigar pressão arterial e sinais de pré-eclâmpsia.',
        ruleVersion: LAB_RISK_RULES_VERSION,
      };
    }
    if (numeric === 0 || (normUnit === 'mg_dl' && numeric < 30) || (normUnit === 'mg_l' && numeric < 300)) {
      return {
        evaluated: true,
        analyteId: 'urine_protein',
        isNormal: true,
        closeRules: ['lab_urine_protein_elevated'],
        ruleVersion: LAB_RISK_RULES_VERSION,
      };
    }
  }

  // Caso qualitativo (fita reagente de urina)
  const positivePattern = /(?:\b(reagente|positivo|positiva|presente)\b|\b[1-4]\+\b|\+{1,4})/;
  const negativePattern = /\b(n[aã]o\s+reagente|negativo|negativa|ausente|tra[cç]os)\b/;

  if (positivePattern.test(textVal)) {
    return {
      evaluated: true,
      analyteId: 'urine_protein',
      ruleId: 'lab_urine_protein_elevated',
      severity: 'yellow',
      level: 'high',
      signalCodes: ['proteinuria_detected', 'proteinuria_qualitative_positive'],
      message: 'Proteinúria reagente detectada em exame de urina. Avaliar pressão arterial e investigar sinais de pré-eclâmpsia.',
      ruleVersion: LAB_RISK_RULES_VERSION,
    };
  }

  if (negativePattern.test(textVal)) {
    return {
      evaluated: true,
      analyteId: 'urine_protein',
      isNormal: true,
      closeRules: ['lab_urine_protein_elevated'],
      ruleVersion: LAB_RISK_RULES_VERSION,
    };
  }

  return {
    evaluated: false,
    reason: 'unrecognized_protein_value',
    analyteId: 'urine_protein',
  };
}

/**
 * Avalia um resultado laboratorial aceito/revisado.
 */
function evaluateLabResult(result) {
  if (!result || !CLINICALLY_USABLE_STATUSES.has(result.status)) {
    return {
      evaluated: false,
      reason: 'not_clinically_usable',
      status: result?.status,
    };
  }

  if (!result.observed_at) {
    return {
      evaluated: false,
      reason: 'missing_observed_at',
      analyteId: result.analyte_id,
    };
  }

  const analyteId = result.analyte_id;
  if (analyteId === 'hemoglobin') {
    return evaluateHemoglobin(result);
  }
  if (analyteId === 'glucose') {
    return evaluateGlucose(result);
  }
  if (analyteId === 'urine_protein') {
    return evaluateUrineProtein(result);
  }

  return {
    evaluated: false,
    reason: 'unsupported_analyte',
    analyteId,
  };
}

/**
 * Fecha alertas gerados por um resultado laboratorial específico
 * (usado quando o resultado é reaberto ou rejeitado).
 */
async function deactivateLabResultAlerts(db, labResultId, reason = 'resultado desativado na revisao') {
  const result = await db.query(
    `UPDATE alert_events
        SET status = 'closed',
            closed_at = CURRENT_TIMESTAMP,
            close_reason = $2,
            updated_at = CURRENT_TIMESTAMP
      WHERE source_type = 'lab_result'
        AND source_id = $1
        AND status IN ('open', 'acknowledged')
      RETURNING *`,
    [String(labResultId), reason]
  );
  return result.rows;
}

/**
 * Sincroniza os alertas de risco decorrentes de uma decisão médica sobre lab_results.
 */
async function syncLabResultRisk(db, labResult, { userId = null } = {}) {
  const labResultId = labResult.id;
  const pregnantId = labResult.pregnant_id;

  // Se o resultado não estiver clinicamente utilizável (rejeitado ou reaberto), fecha alertas existentes dele
  if (!CLINICALLY_USABLE_STATUSES.has(labResult.status)) {
    const closed = await deactivateLabResultAlerts(
      db,
      labResultId,
      `resultado com status ${labResult.status} na revisão médica`
    );
    return { status: 'deactivated', closedCount: closed.length, closed };
  }

  // Localiza a gestação ativa da paciente
  const pregResult = await db.query(
    `SELECT id, weeks FROM pregnancies
      WHERE pregnant_id = $1
      ORDER BY created_at DESC LIMIT 1`,
    [pregnantId]
  );

  let pregnancyId = pregResult.rows[0]?.id;
  if (!pregnancyId) {
    // Se não houver gestação cadastrada, cria uma de fallback para manter integridade referencial
    const createdPreg = await db.query(
      `INSERT INTO pregnancies (pregnant_id, weeks, status)
       VALUES ($1, 0, 'active')
       RETURNING id`,
      [pregnantId]
    );
    pregnancyId = createdPreg.rows[0].id;
  }

  const evaluation = evaluateLabResult(labResult);
  if (!evaluation.evaluated) {
    return {
      status: 'ignored',
      reason: evaluation.reason,
      analyteId: labResult.analyte_id,
    };
  }

  // Se o resultado for normal, fecha alertas correlatos abertos
  if (evaluation.isNormal && Array.isArray(evaluation.closeRules)) {
    const closedEvents = [];
    for (const ruleId of evaluation.closeRules) {
      const closed = await autoCloseNormalAlert(db, {
        pregnancyId,
        ruleId,
        severity: 'yellow',
      });
      closedEvents.push(...closed);

      // Também fecha crítico se for hemoglobina
      if (ruleId === 'lab_hemoglobin_severe') {
        const closedSevere = await db.query(
          `UPDATE alert_events
              SET status = 'closed', closed_at = CURRENT_TIMESTAMP,
                  close_reason = 'nova medida aceita e normal', updated_at = CURRENT_TIMESTAMP
            WHERE pregnancy_id = $1 AND rule_id = $2 AND severity = 'red'
              AND status IN ('open', 'acknowledged')
            RETURNING *`,
          [pregnancyId, ruleId]
        );
        closedEvents.push(...closedSevere.rows);
      }
    }
    return {
      status: 'normal',
      closedCount: closedEvents.length,
      closed: closedEvents,
    };
  }

  // Gera ou atualiza o evento de alerta
  const alertPayload = {
    pregnancy_id: pregnancyId,
    pregnant_id: pregnantId,
    rule_id: evaluation.ruleId,
    severity: evaluation.severity,
    source_type: 'lab_result',
    source_id: String(labResultId),
    message: evaluation.message,
    signal_codes: [
      ...evaluation.signalCodes,
      `version:${evaluation.ruleVersion}`,
      `analyte:${evaluation.analyteId}`,
    ],
  };

  const outcome = await upsertAlertEvent(db, alertPayload);

  return {
    status: 'alert_created',
    event: outcome.event,
    created: outcome.created,
    ruleId: evaluation.ruleId,
    severity: evaluation.severity,
  };
}

module.exports = {
  LAB_RISK_RULES_VERSION,
  deactivateLabResultAlerts,
  evaluateGlucose,
  evaluateHemoglobin,
  evaluateLabResult,
  evaluateUrineProtein,
  normalizeUnit,
  syncLabResultRisk,
};
