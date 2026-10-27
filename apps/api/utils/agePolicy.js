const MINIMUM_AGE_YEARS = 18;

function parseCivilDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) return null;
  return date;
}

function ageAt(dateOfBirth, today = new Date()) {
  const birthdate = parseCivilDate(dateOfBirth);
  const reference = today instanceof Date ? today : new Date(today);
  if (!birthdate || Number.isNaN(reference.getTime())) return null;

  let age = reference.getUTCFullYear() - birthdate.getUTCFullYear();
  const birthdayNotReached = (
    reference.getUTCMonth() < birthdate.getUTCMonth()
    || (
      reference.getUTCMonth() === birthdate.getUTCMonth()
      && reference.getUTCDate() < birthdate.getUTCDate()
    )
  );
  if (birthdayNotReached) age -= 1;
  return age;
}

function validateAdultBirthdate(dateOfBirth, today = new Date()) {
  const age = ageAt(dateOfBirth, today);
  if (age === null) {
    return { valid: false, code: 'INVALID_BIRTHDATE', message: 'Data de nascimento inválida.' };
  }
  if (age < MINIMUM_AGE_YEARS) {
    return { valid: false, code: 'MINIMUM_AGE_REQUIRED', message: 'O cadastro exige idade mínima de 18 anos.' };
  }
  return { valid: true, age };
}

module.exports = {
  MINIMUM_AGE_YEARS,
  ageAt,
  parseCivilDate,
  validateAdultBirthdate,
};
