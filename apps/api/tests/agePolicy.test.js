const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ageAt,
  parseCivilDate,
  validateAdultBirthdate,
} = require('../utils/agePolicy');

const TODAY = new Date('2026-10-27T12:00:00Z');

test('valida datas civis e calcula idade sem deslocamento de fuso', () => {
  assert.equal(parseCivilDate('2008-10-27').toISOString(), '2008-10-27T00:00:00.000Z');
  assert.equal(parseCivilDate('2008-02-30'), null);
  assert.equal(ageAt('2008-10-27', TODAY), 18);
  assert.equal(ageAt('2008-10-28', TODAY), 17);
});

test('bloqueia menores de 18 e aceita adulto no limite', () => {
  assert.deepEqual(validateAdultBirthdate('2008-10-28', TODAY), {
    valid: false,
    code: 'MINIMUM_AGE_REQUIRED',
    message: 'O cadastro exige idade mínima de 18 anos.',
  });
  assert.deepEqual(validateAdultBirthdate('2008-10-27', TODAY), { valid: true, age: 18 });
});

test('rejeita data inválida explicitamente', () => {
  assert.equal(validateAdultBirthdate('27/10/2008', TODAY).code, 'INVALID_BIRTHDATE');
});
