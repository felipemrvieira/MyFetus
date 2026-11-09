const FHIR_VERSION = 'R4-experimental-v1';
const FHIR_SYSTEM = 'https://myfetus.app/fhir';

const OBSERVATION_CODES = Object.freeze({
  bloodPressure: { code: '85354-9', display: 'Blood pressure panel with all children optional' },
  systolic: { code: '8480-6', display: 'Systolic blood pressure' },
  diastolic: { code: '8462-4', display: 'Diastolic blood pressure' },
  weight: { code: '29463-7', display: 'Body weight' },
  glucose: { code: '2339-0', display: 'Glucose [Mass/volume] in Blood' },
});

class FhirExportError extends Error {
  constructor(message, status = 400, code = 'FHIR_EXPORT_INVALID') {
    super(message);
    this.name = 'FhirExportError';
    this.status = status;
    this.code = code;
  }
}

function validatePregnancyId(value) {
  const pregnancyId = Number(value);
  if (!Number.isInteger(pregnancyId) || pregnancyId <= 0) {
    throw new FhirExportError('pregnancy_id invalido');
  }
  return pregnancyId;
}

function parseNumeric(value) {
  if (value === null || value === undefined || value === '') return null;
  const normalized = String(value).replace(',', '.');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value !== 'string') return null;
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value.trim());
  if (!match) return null;
  const date = new Date(`${match[1]}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : match[1];
}

function resourceId(prefix, sourceId) {
  const safeId = String(sourceId || 'unknown').replace(/[^a-zA-Z0-9.-]/g, '-');
  return `${prefix}-${safeId}`;
}

function baseObservation({ id, code, display, date, subjectReference, category }) {
  return {
    resourceType: 'Observation',
    id,
    status: 'final',
    category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: category }] }],
    code: {
      coding: [{ system: 'http://loinc.org', code, display }],
      text: display,
    },
    subject: { reference: subjectReference },
    effectiveDateTime: date,
  };
}

function quantity(value, unit, system = 'http://unitsofmeasure.org') {
  return {
    value,
    unit,
    system,
    code: unit,
  };
}

function buildSingleObservation({ id, code, display, date, value, unit, subjectReference, category }) {
  return {
    ...baseObservation({ id, code, display, date, subjectReference, category }),
    valueQuantity: quantity(value, unit),
  };
}

function buildBloodPressureObservation({ id, date, systolic, diastolic, subjectReference }) {
  const observation = baseObservation({
    id,
    code: OBSERVATION_CODES.bloodPressure.code,
    display: 'Blood pressure panel',
    date,
    subjectReference,
    category: 'vital-signs',
  });
  observation.component = [];
  if (systolic !== null) {
    observation.component.push({
      code: { coding: [{ system: 'http://loinc.org', ...OBSERVATION_CODES.systolic }] },
      valueQuantity: quantity(systolic, 'mm[Hg]'),
    });
  }
  if (diastolic !== null) {
    observation.component.push({
      code: { coding: [{ system: 'http://loinc.org', ...OBSERVATION_CODES.diastolic }] },
      valueQuantity: quantity(diastolic, 'mm[Hg]'),
    });
  }
  return observation.component.length > 0 ? observation : null;
}

function buildPatientResource(pregnancyId) {
  return {
    resourceType: 'Patient',
    id: `pregnancy-${pregnancyId}`,
    identifier: [{
      system: `${FHIR_SYSTEM}/identifier/pregnancy`,
      value: String(pregnancyId),
    }],
    extension: [{
      url: `${FHIR_SYSTEM}/StructureDefinition/export-anonymization`,
      valueCode: 'pseudonymous-internal-id',
    }],
  };
}

function buildFhirBundle({ pregnancyId, dailyEntries = [], maternalWeights = [], labResults = [], now = new Date() }) {
  const patient = buildPatientResource(pregnancyId);
  const subjectReference = `Patient/${patient.id}`;
  const observations = [];

  for (const row of dailyEntries) {
    const date = parseDate(row.entry_date);
    if (!date) continue;
    const bloodPressure = buildBloodPressureObservation({
      id: resourceId('daily-bp', row.id),
      date,
      systolic: parseNumeric(row.systolic),
      diastolic: parseNumeric(row.diastolic),
      subjectReference,
    });
    if (bloodPressure) observations.push(bloodPressure);

    const weight = parseNumeric(row.weight_kg);
    if (weight !== null) {
      observations.push(buildSingleObservation({
        id: resourceId('daily-weight', row.id),
        ...OBSERVATION_CODES.weight,
        date,
        value: weight,
        unit: 'kg',
        subjectReference,
        category: 'vital-signs',
      }));
    }

    const glucose = parseNumeric(row.glucose_mg_dl);
    if (glucose !== null) {
      observations.push(buildSingleObservation({
        id: resourceId('daily-glucose', row.id),
        ...OBSERVATION_CODES.glucose,
        date,
        value: glucose,
        unit: 'mg/dL',
        subjectReference,
        category: 'laboratory',
      }));
    }
  }

  for (const row of maternalWeights) {
    const date = parseDate(row.measured_at);
    const weight = parseNumeric(row.weight_kg);
    if (date && weight !== null) {
      observations.push(buildSingleObservation({
        id: resourceId('maternal-weight', row.id),
        ...OBSERVATION_CODES.weight,
        date,
        value: weight,
        unit: 'kg',
        subjectReference,
        category: 'vital-signs',
      }));
    }
  }

  for (const row of labResults) {
    const date = parseDate(row.observed_at);
    const glucose = parseNumeric(row.value);
    if (date && glucose !== null) {
      observations.push(buildSingleObservation({
        id: resourceId('lab-glucose', row.id),
        ...OBSERVATION_CODES.glucose,
        date,
        value: glucose,
        unit: row.unit || 'mg/dL',
        subjectReference,
        category: 'laboratory',
      }));
    }
  }

  return {
    resourceType: 'Bundle',
    id: `fhir-export-${pregnancyId}`,
    meta: {
      tag: [{
        system: `${FHIR_SYSTEM}/export`,
        code: 'experimental',
        display: 'Exportacao experimental; nao destinada a integracao clinica produtiva',
      }],
    },
    identifier: {
      system: `${FHIR_SYSTEM}/export-version`,
      value: FHIR_VERSION,
    },
    type: 'collection',
    timestamp: new Date(now).toISOString(),
    entry: [{ resource: patient }, ...observations.map((resource) => ({ resource }))],
  };
}

async function getFhirExport(db, { pregnancyId: pregnancyIdValue, crypto, now }) {
  const pregnancyId = validatePregnancyId(pregnancyIdValue);
  const pregnancyResult = await db.query(
    `SELECT id, pregnant_id FROM pregnancies WHERE id = $1`,
    [pregnancyId]
  );
  const pregnancy = pregnancyResult.rows[0];
  if (!pregnancy) {
    throw new FhirExportError('Gestacao nao encontrada', 404, 'PREGNANCY_NOT_FOUND');
  }

  const [dailyResult, weightsResult, labsResult] = await Promise.all([
    db.query(
      `SELECT * FROM daily_entries
       WHERE pregnancy_id = $1 AND is_current = TRUE
       ORDER BY entry_date ASC, id ASC LIMIT 500`,
      [pregnancy.id]
    ),
    db.query(
      `SELECT * FROM maternal_weight_history
       WHERE pregnancy_id = $1 AND deleted_at IS NULL
       ORDER BY measured_at ASC, id ASC LIMIT 500`,
      [pregnancy.id]
    ),
    db.query(
      `SELECT * FROM lab_results
       WHERE pregnant_id = $1
         AND analyte_id IN ('glucose', 'fasting_glucose')
         AND status IN ('accepted', 'corrected')
       ORDER BY observed_at ASC, id ASC LIMIT 500`,
      [pregnancy.pregnant_id]
    ),
  ]);

  const dailyEntries = dailyResult.rows.map((row) => crypto.decryptRecord(row, 'daily_entries'));
  const maternalWeights = weightsResult.rows;
  const labResults = labsResult.rows.map((row) => crypto.decryptRecord(row, 'lab_results'));
  return buildFhirBundle({ pregnancyId: pregnancy.id, dailyEntries, maternalWeights, labResults, now });
}

module.exports = {
  FHIR_VERSION,
  FhirExportError,
  OBSERVATION_CODES,
  buildBloodPressureObservation,
  buildFhirBundle,
  buildPatientResource,
  getFhirExport,
  parseNumeric,
  validatePregnancyId,
};
