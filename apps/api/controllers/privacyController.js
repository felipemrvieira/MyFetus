const bcrypt = require('bcrypt');
const client = require('../backend');
const logger = require('../utils/logger');
const cryptoService = require('../services/cryptoService');
const { audit } = require('../services/auditService');
const { createDataExportService, summarize } = require('../services/dataExportService');

const exportService = createDataExportService({ crypto: cryptoService });

function exportFileName(date) {
  return `myfetus-meus-dados-${date.toISOString().slice(0, 10)}.json`;
}

function auditExport(req, outcome, detail) {
  audit(req, {
    action: 'DATA_EXPORT',
    resource: 'users',
    resource_id: req.user.id,
    outcome,
    detail,
  });
}

// Confirma a senha do próprio titular antes de liberar a exportação.
// Senha errada responde 403, não 401: o app trata 401 como sessão expirada e desloga.
async function passwordMatches(dbClient, userId, password) {
  const result = await dbClient.query(
    'SELECT password, is_active FROM users WHERE id = $1',
    [userId]
  );
  const stored = result.rows[0];
  if (!stored || !stored.is_active || typeof stored.password !== 'string') return false;
  return bcrypt.compare(password, stored.password);
}

// O titular é sempre o usuário do token: não há ID de usuário no corpo nem na URL.
const exportMyData = async (req, res) => {
  const { password } = req.body || {};
  if (typeof password !== 'string' || password.length === 0) {
    return res.status(400).json({ error: 'Confirme sua senha para exportar os dados', code: 'PASSWORD_REQUIRED' });
  }

  let dbClient;
  try {
    dbClient = await client.connect();

    if (!(await passwordMatches(dbClient, req.user.id, password))) {
      auditExport(req, 'FAILURE', { reason: 'invalid_password' });
      return res.status(403).json({ error: 'Senha incorreta', code: 'INVALID_PASSWORD' });
    }

    // Leitura num único snapshot, para as seções do arquivo serem coerentes entre si.
    await dbClient.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const exportData = await exportService.buildExport(dbClient, { userId: req.user.id });
    await dbClient.query('COMMIT');

    if (!exportData) {
      auditExport(req, 'FAILURE', { reason: 'user_not_found' });
      return res.status(403).json({ error: 'Senha incorreta', code: 'INVALID_PASSWORD' });
    }

    auditExport(req, 'SUCCESS', { format: 'json', sections: summarize(exportData) });

    res.set('Cache-Control', 'no-store');
    res.attachment(exportFileName(new Date(exportData.gerado_em)));
    return res.status(200).json(exportData);
  } catch (error) {
    if (dbClient) await dbClient.query('ROLLBACK').catch(() => {});
    logger.error('Erro ao exportar dados do titular', { details: error.message });
    auditExport(req, 'FAILURE', { reason: 'internal_error' });
    return res.status(500).json({ error: 'Erro ao exportar dados' });
  } finally {
    if (dbClient) dbClient.release();
  }
};

module.exports = {
  exportMyData,
};
