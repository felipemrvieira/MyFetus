const client = require('../backend');
const cryptoService = require('../services/cryptoService');
const { decryptPregnantDetails } = require('../services/clinicalDataService');
const { evaluatePatientRisk } = require('../services/riskAlertService');
const logger = require('../utils/logger');
const { audit } = require('../services/auditService');
const { ensureCanAccessPregnant } = require('../utils/clinicalAccess');
const { sendInternalError } = require('../utils/httpErrors');

const SEVERITY_WEIGHT = { green: 0, yellow: 1, red: 2, pending: -1 };

function containsEncryptedValue(record) {
  return Object.values(record || {}).some((value) => cryptoService.isEncrypted(value));
}

function decryptIfNeeded(row) {
  const encrypted = containsEncryptedValue(row) || containsEncryptedValue(row.latest_pregnancy);

  return encrypted
    ? decryptPregnantDetails(row, row.latest_pregnancy, [])
    : { ...row, all_events: [] };
}

function mapRuleToCategoryKey(ruleId) {
  if (ruleId.startsWith('lab_hemoglobin')) return 'hemoglobina';
  if (ruleId.startsWith('lab_glucose') || ruleId.includes('glucose')) return 'glicemia';
  if (ruleId.startsWith('lab_urine_protein')) return 'proteinuria';
  return null;
}

const getPatientAlerts = async (req, res) => {
  const { id } = req.params;

  try {
    // Alertas agregam dados clínicos sensíveis. Autoriza antes de carregar o
    // prontuário, inclusive para impedir acesso fora do vínculo ativo.
    if (!(await ensureCanAccessPregnant(req, res, id))) return;

    const result = await client.query(
      `SELECT
        u.name AS patient_name,
        u.birthdate,
        p.*,
        (
          SELECT json_build_object(
            'id', preg.id,
            'weeks', preg.weeks,
            'glicemia', preg.glicemia,
            'frequencia_cardiaca', preg.frequencia_cardiaca,
            'altura_uterina', preg.altura_uterina,
            'dum', preg.dum,
            'dpp', preg.dpp
          )
          FROM pregnancies preg
          WHERE preg.pregnant_id = p.id
          ORDER BY preg.created_at DESC
          LIMIT 1
        ) AS latest_pregnancy
      FROM pregnants p
      JOIN users u ON p.user_id = u.id
      WHERE p.id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Gestante não encontrada' });
    }

    const patient = decryptIfNeeded(result.rows[0]);
    const risk = evaluatePatientRisk(patient, patient.latest_pregnancy);

    // E2-07: Incorpora alertas ativos gerados por exames laboratoriais (lab_results)
    const activeAlertsResult = await client.query(
      `SELECT * FROM alert_events
        WHERE pregnant_id = $1 AND status IN ('open', 'acknowledged')
        ORDER BY last_seen_at DESC`,
      [id]
    );

    const activeEvents = activeAlertsResult.rows;
    for (const event of activeEvents) {
      const catKey = mapRuleToCategoryKey(event.rule_id);
      if (catKey) {
        const existingCat = risk.categories[catKey];
        const newWeight = SEVERITY_WEIGHT[event.severity] || 0;
        const currentWeight = SEVERITY_WEIGHT[existingCat?.level] || 0;

        if (!existingCat || newWeight > currentWeight) {
          risk.categories[catKey] = {
            level: event.severity,
            status: 'alert',
            label: event.severity === 'red' ? 'Crítico' : 'Atenção',
            detail: event.message,
            missing_fields: [],
            alerts: [{ ruleId: event.rule_id, severity: event.severity, evidence: event.message }],
          };
        }
      }

      // Atualiza severidade geral se o evento for mais grave
      if (SEVERITY_WEIGHT[event.severity] > (SEVERITY_WEIGHT[risk.overall_level] || 0)) {
        risk.overall_level = event.severity;
      }
    }

    // Recalcula contagens com as categorias atualizadas
    const newCounts = { green: 0, yellow: 0, red: 0, pending: 0 };
    Object.values(risk.categories).forEach((cat) => {
      if (!cat) return;
      if (cat.status?.startsWith('pending_')) newCounts.pending += 1;
      else if (newCounts[cat.level] !== undefined) newCounts[cat.level] += 1;
    });
    risk.alert_counts = newCounts;

    audit(req, {
      action: 'ALERT_ACCESSED',
      resource: 'alerts',
      resource_id: id,
      outcome: 'SUCCESS',
      detail: {
        overall_level: risk.overall_level,
        alert_counts: risk.alert_counts,
        catalog_version: risk.catalog_version,
      },
    });

    return res.json({
      patient_id: id,
      patient_name: patient.patient_name,
      ...risk,
      active_events: activeEvents.map((evt) => ({
        id: evt.id,
        rule_id: evt.rule_id,
        severity: evt.severity,
        source_type: evt.source_type,
        source_id: evt.source_id,
        message: evt.message,
        last_seen_at: evt.last_seen_at,
      })),
    });
  } catch (err) {
    logger.error('Erro ao gerar alertas', { details: err.message, pregnantId: id });
    return sendInternalError(res);
  }
};

module.exports = { getPatientAlerts };
