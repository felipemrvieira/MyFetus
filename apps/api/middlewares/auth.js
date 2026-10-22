const jwt = require('jsonwebtoken'); 
const logger = require('../utils/logger');

function authenticateToken(req, res, next) {
  if (req.consentChecked && req.user) return next();

  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({ error: 'Token não informado' });
  }

  const [scheme, token] = authHeader.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Formato de token inválido' });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = payload;
    return next();
  } catch (err) {
    if (process.env.JWT_SECRET_PREVIOUS && err.name === 'JsonWebTokenError') {
      try {
        const payload = jwt.verify(token, process.env.JWT_SECRET_PREVIOUS);
        req.user = payload;
        logger.info('Autenticação com JWT_SECRET_PREVIOUS realizada com sucesso', {
          code: 'AUTH_TOKEN_PREVIOUS_KEY',
          userId: payload.id,
          role: payload.role,
        });
        return next();
      } catch (prevErr) {
        logger.warn('Falha de autenticação com segredo anterior', {
          code: 'AUTH_TOKEN_INVALID',
          reason: prevErr.name,
        });
        return res.status(401).json({ error: 'Token inválido ou expirado' });
      }
    }

    logger.warn('Falha de autenticação', { code: 'AUTH_TOKEN_INVALID', reason: err.name });
    return res.status(401).json({ error: 'Token inválido ou expirado' });
  }
}

function requireRole(...allowedRoles) {
  const middleware = (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Usuário não autenticado' });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Acesso negado' });
    }

    next();
  };

  // Exposto para o verificador do contrato OpenAPI comparar os papeis documentados.
  middleware.allowedRoles = Object.freeze([...allowedRoles]);
  return middleware;
}

module.exports = {
  authenticateToken,
  requireRole
};
