// Catálogo mínimo compartilhado pelo mapper e pelo inicializador do banco.
// A ausência de conexão com o banco não pode impedir o parser sintético de
// marcar um resultado como pendente ou mapeado com a versão local do catálogo.
const INITIAL_LOINC_CATALOG = [
  { loinc: '718-7', canonicalTerm: 'Hemoglobina', aliases: ['hb', 'hemoglobin', 'hemoglobina', 'hemoglobina total'], category: 'hematologia', specimen: 'sangue', unit: 'g/dL' },
  { loinc: '4544-3', canonicalTerm: 'Hematócrito', aliases: ['hematocrito', 'hct', 'hematócrito'], category: 'hematologia', specimen: 'sangue', unit: '%' },
  { loinc: '6690-2', canonicalTerm: 'Leucócitos', aliases: ['leucocitos', 'wbc', 'white blood cells', 'leucócitos'], category: 'hematologia', specimen: 'sangue', unit: '10^3/uL' },
  { loinc: '777-3', canonicalTerm: 'Plaquetas', aliases: ['plaquetas', 'platelets', 'plt'], category: 'hematologia', specimen: 'sangue', unit: '10^3/uL' },
  { loinc: '2345-7', canonicalTerm: 'Glicose', aliases: ['glicose', 'glucose', 'glicemia'], category: 'bioquimica', specimen: 'sangue', unit: 'mg/dL' },
  { loinc: '2160-0', canonicalTerm: 'Creatinina', aliases: ['creatinina', 'creatinine'], category: 'bioquimica', specimen: 'sangue', unit: 'mg/dL' },
  { loinc: '3094-0', canonicalTerm: 'Ureia', aliases: ['ureia', 'urea nitrogen', 'bun'], category: 'bioquimica', specimen: 'sangue', unit: 'mg/dL' },
  { loinc: '1920-8', canonicalTerm: 'AST/TGO', aliases: ['ast', 'tgo', 'ast/tgo', 'aspartate aminotransferase'], category: 'enzimas', specimen: 'sangue', unit: 'U/L' },
  { loinc: '1742-6', canonicalTerm: 'ALT/TGP', aliases: ['alt', 'tgp', 'alt/tgp', 'alanine aminotransferase'], category: 'enzimas', specimen: 'sangue', unit: 'U/L' },
  { loinc: '2276-4', canonicalTerm: 'Ferritina', aliases: ['ferritina', 'ferritin'], category: 'estoque de ferro', specimen: 'sangue', unit: 'ng/mL' },
];

module.exports = { INITIAL_LOINC_CATALOG };
