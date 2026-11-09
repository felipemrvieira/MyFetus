/**
 * blindValidationSheet.js
 *
 * Gera a ficha de classificação da validação cega (E3-09.1) a partir de
 * data/blind-validation/cases.v1.json. A ficha mostra só os dados de cada
 * caso sintético, sem resultado esperado, regra-alvo ou saída do motor.
 *
 * Uso: node scripts/blindValidationSheet.js
 * (reescreve docs/riscos/validacao-cega/ficha-classificacao.md)
 */

const fs = require('fs');
const path = require('path');

const CASES_PATH = path.join(__dirname, '..', 'data', 'blind-validation', 'cases.v1.json');
const SHEET_PATH = path.join(__dirname, '..', '..', '..', 'docs', 'riscos', 'validacao-cega', 'ficha-classificacao.md');

const NOT_INFORMED = '**não informado**';

const GLUCOSE_TYPES = {
  fasting: 'glicemia de jejum',
  casual: 'glicemia casual',
  ogtt75g: 'TOTG 75 g',
};

const PREGNANCY_FLAGS = {
  bleeding: 'sangramento',
  fluid_loss: 'perda de líquido',
  hiv: 'HIV',
  syphilis: 'sífilis',
  hypertension: 'hipertensão',
  gestational_diabetes: 'diabetes gestacional',
  insulin: 'uso de insulina',
  anemia: 'anemia',
  urinary_infection: 'infecção urinária',
  toxoplasmosis: 'toxoplasmose',
  smoking: 'tabagismo',
  alcohol: 'consumo de álcool',
  rh_immunization: 'isoimunização Rh',
  fever: 'febre',
  rash: 'exantema',
};

const VACCINATION = { regular: 'em dia', pending: 'pendente' };

function has(input, field) {
  return input[field] !== undefined && input[field] !== null && input[field] !== '';
}

function formatNumber(value) {
  return String(value).replace('.', ',');
}

function yesNo(value) {
  return value ? 'sim' : 'não';
}

function describeCase(input) {
  const rows = [];
  rows.push(['Idade materna', has(input, 'maternalAge') ? `${input.maternalAge} anos` : NOT_INFORMED]);
  rows.push(['Idade gestacional', has(input, 'gestationalWeeks') ? `${input.gestationalWeeks} semanas` : NOT_INFORMED]);
  rows.push([
    'Pressão arterial',
    has(input, 'systolic') && has(input, 'diastolic') ? `${input.systolic}/${input.diastolic} mmHg` : NOT_INFORMED,
  ]);
  rows.push([
    'Glicemia',
    has(input, 'glucoseType') && has(input, 'glucoseValue')
      ? `${GLUCOSE_TYPES[input.glucoseType] || input.glucoseType}: ${formatNumber(input.glucoseValue)} mg/dL`
      : NOT_INFORMED,
  ]);
  rows.push(['IMC pré-gestacional', has(input, 'prePregnancyBmi') ? `${formatNumber(input.prePregnancyBmi.toFixed(1))} kg/m²` : NOT_INFORMED]);
  rows.push(['Altura uterina', has(input, 'fundalHeight') ? `${formatNumber(input.fundalHeight)} cm` : NOT_INFORMED]);
  rows.push(['Percentil da altura uterina', has(input, 'fundalHeightPercentile') ? `P${input.fundalHeightPercentile}` : NOT_INFORMED]);
  rows.push(['Frequência cardíaca fetal', has(input, 'fetalHeartRate') ? `${input.fetalHeartRate} bpm` : NOT_INFORMED]);
  rows.push(['Antecedente familiar de atenção', has(input, 'familyHistory') ? yesNo(input.familyHistory) : NOT_INFORMED]);
  rows.push(['Antecedente clínico de atenção', has(input, 'clinicalHistory') ? yesNo(input.clinicalHistory) : NOT_INFORMED]);
  rows.push(['Fator de risco em gestação anterior', has(input, 'previousPregnancyRisk') ? yesNo(input.previousPregnancyRisk) : NOT_INFORMED]);
  rows.push([
    'Sinais na gestação atual',
    Array.isArray(input.currentPregnancyFlags)
      ? (input.currentPregnancyFlags.length
        ? input.currentPregnancyFlags.map((flag) => PREGNANCY_FLAGS[flag] || flag).join(', ')
        : 'nenhum registrado')
      : NOT_INFORMED,
  ]);
  rows.push(['Vacinação', has(input, 'vaccinationStatus') ? VACCINATION[input.vaccinationStatus] || input.vaccinationStatus : NOT_INFORMED]);
  return rows;
}

function renderSheet(dataset) {
  const lines = [
    '# Ficha de classificação — validação cega do motor de risco',
    '',
    '<!-- Arquivo gerado por apps/api/scripts/blindValidationSheet.js. Não editar à mão. -->',
    '',
    '| Campo | Valor |',
    '| --- | --- |',
    `| Conjunto de casos | ${dataset.datasetId} v${dataset.datasetVersion} (${dataset.status}) |`,
    `| Catálogo de regras congelado | v${dataset.frozen.catalogVersion} |`,
    '| Protocolo | [`protocolo.md`](protocolo.md) |',
    '| Avaliador(a) | ______________________ |',
    '| Data | ___/___/______ |',
    '',
    '> Todos os casos são **sintéticos**: não representam pessoas reais.',
    '> Classifique cada caso pelo seu julgamento clínico, **sem consultar o MyFetus**,',
    '> o motor de risco, o catálogo de regras ou a matriz de cobertura da equipe.',
    '',
    '## Como classificar',
    '',
    'Para cada caso, marque **uma** opção de classificação geral:',
    '',
    '- **Verde** — sem sinal de atenção.',
    '- **Amarelo** — sinal de atenção ou risco intermediário.',
    '- **Vermelho** — sinal crítico ou atenção imediata.',
    '- **Inconclusivo** — o caso não tem resposta clínica única.',
    '',
    'Marque também **"faltam dados"** quando algum dado ausente impedir avaliar uma parte do caso.',
    'Uma justificativa curta é obrigatória para vermelho, inconclusivo e "faltam dados".',
    '',
  ];

  for (const item of dataset.cases) {
    lines.push(`## ${item.id}`, '', '| Dado | Valor |', '| --- | --- |');
    for (const [label, value] of describeCase(item.input)) {
      lines.push(`| ${label} | ${value} |`);
    }
    lines.push(
      '',
      'Classificação: [ ] Verde  [ ] Amarelo  [ ] Vermelho  [ ] Inconclusivo  ·  [ ] Faltam dados',
      '',
      'Justificativa: ______________________________________________',
      ''
    );
  }

  return `${lines.join('\n').trimEnd()}\n`;
}

function loadCases(casesPath = CASES_PATH) {
  return JSON.parse(fs.readFileSync(casesPath, 'utf8'));
}

if (require.main === module) {
  fs.mkdirSync(path.dirname(SHEET_PATH), { recursive: true });
  fs.writeFileSync(SHEET_PATH, renderSheet(loadCases()));
  process.stdout.write(`Ficha gerada em ${path.relative(process.cwd(), SHEET_PATH)}\n`);
}

module.exports = { CASES_PATH, SHEET_PATH, describeCase, loadCases, renderSheet };
