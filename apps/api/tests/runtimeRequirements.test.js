const test = require('node:test');
const assert = require('node:assert/strict');

const { validateRuntimeRequirements } = require('../config/runtimeRequirements');

test('não exige segredo de produção no ambiente de testes', () => {
  assert.deepEqual(validateRuntimeRequirements({ NODE_ENV: 'test' }), {
    checked: false,
    environment: 'test',
  });
});

test('produção falha antes do boot quando a chave AES não existe', () => {
  assert.throws(
    () => validateRuntimeRequirements({ NODE_ENV: 'production', AES_KEY_VERSION: '1' }),
    error => error.code === 'AES_KEY_REQUIRED'
  );
});

test('produção aceita chave AES versionada válida', () => {
  const result = validateRuntimeRequirements({
    NODE_ENV: 'production',
    AES_KEY_VERSION: '1',
    AES_ENCRYPTION_KEY_V1: 'a'.repeat(64),
  });
  assert.deepEqual(result, { checked: true, environment: 'production' });
});
