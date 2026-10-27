const cryptoService = require('../services/cryptoService');

function validateRuntimeRequirements(env = process.env) {
  if (env.NODE_ENV !== 'production') {
    return { checked: false, environment: env.NODE_ENV || 'development' };
  }

  try {
    cryptoService.createCryptoService({ env });
  } catch (error) {
    const wrapped = new Error('Chave AES obrigatória não configurada para produção.');
    wrapped.code = 'AES_KEY_REQUIRED';
    wrapped.cause = error;
    throw wrapped;
  }

  return { checked: true, environment: 'production' };
}

module.exports = { validateRuntimeRequirements };
