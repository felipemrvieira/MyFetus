const client = require('../backend');
const cryptoService = require('../services/cryptoService');
const { decryptPregnantDetails } = require('../services/clinicalDataService');
const { evaluatePatientRisk } = require('../services/riskAlertService');
const logger = require('../utils/logger');
const { audit } = require('../services/auditService');
const { ensureCanAccessPregnant } = require('../utils/clinicalAccess');
const { sendInternalError } = require('../utils/httpErrors');

function containsEncryptedValue(record) {
  return Object.values(record || {}).some((value) => cryptoService.isEncrypted(value));
}

function decryptIfNeeded(row) {
  const encrypted = containsEncryptedValue(row) || containsEncryptedValue(row.latest_pregnancy);

  return encrypted
    ? decryptPregnantDetails(row, row.latest_pregnancy, [])
    : { ...row, all_events: [] };
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
    });
  } catch (err) {
    logger.error('Erro ao gerar alertas', { details: err.message, pregnantId: id });
    return sendInternalError(res);
  }
};

module.exports = { getPatientAlerts };
