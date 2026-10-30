const client = require('../backend');
const { decryptPregnantSummary } = require('../services/clinicalDataService');
const {
  DashboardQueryError,
  buildDashboard,
  parseDashboardQuery,
} = require('../services/doctorDashboardService');
const { sendInternalError } = require('../utils/httpErrors');

// Só pacientes com vínculo ativo com o médico do token (E3-10, decisão do P.O.).
const LINKED_PATIENTS_SQL = `
  SELECT p.id AS pregnant_id, u.name AS patient_name, u.birthdate,
    (SELECT weeks FROM pregnancies preg
      WHERE preg.pregnant_id = p.id
      ORDER BY preg.created_at DESC LIMIT 1) AS semanas_gestacao
  FROM pregnants p
  JOIN users u ON p.user_id = u.id
  JOIN doctor_patient_links dpl ON dpl.pregnant_id = p.id
  WHERE u.role = 'gestante' AND dpl.doctor_id = $1 AND dpl.status = 'active'`;

const ACTIVE_ALERTS_SQL = `
  SELECT pregnant_id, severity, status, last_seen_at
  FROM alert_events
  WHERE pregnant_id = ANY($1::int[]) AND status IN ('open', 'acknowledged')`;

async function getMyDashboard(req, res) {
  let filters;
  try {
    filters = parseDashboardQuery(req.query);
  } catch (error) {
    if (error instanceof DashboardQueryError) {
      return res.status(400).json({ error: error.validationMessage });
    }
    return sendInternalError(res);
  }

  try {
    const patientsResult = await client.query(LINKED_PATIENTS_SQL, [req.user.id]);
    const patients = patientsResult.rows.map((row) => {
      const decrypted = decryptPregnantSummary(row);
      return {
        pregnant_id: decrypted.pregnant_id,
        nome: decrypted.patient_name,
        ig_semanas: decrypted.semanas_gestacao,
      };
    });

    const pregnantIds = patients.map((patient) => Number(patient.pregnant_id));
    const alerts = pregnantIds.length
      ? (await client.query(ACTIVE_ALERTS_SQL, [pregnantIds])).rows
      : [];

    return res.json(buildDashboard(patients, alerts, filters));
  } catch (error) {
    return sendInternalError(res);
  }
}

module.exports = { getMyDashboard };
