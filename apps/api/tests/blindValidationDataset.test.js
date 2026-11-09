const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { loadCatalog, validateInput } = require('../services/riskEngine');
const { SHEET_PATH, renderSheet } = require('../scripts/blindValidationSheet');

// E3-09.1 (#167): conjunto de casos cegos, matriz de cobertura e modelo do gabarito.
// Este teste NÃO executa o motor de risco: a execução é a E3-09.2 (#168).

const API_ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(API_ROOT, 'data', 'blind-validation');
const dataset = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'cases.v1.json'), 'utf8'));
const coverage = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'coverage.v1.json'), 'utf8'));
const gabarito = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'gabarito.v1.template.json'), 'utf8'));
const catalog = loadCatalog();

const EXPECTED_TYPE_COUNTS = {
  normal: 3,
  limite: 6,
  combinacao: 3,
  ausencia: 3,
  alto_risco: 3,
  conflitante: 2,
};

function normalizedSha256(relativePath) {
  const content = fs.readFileSync(path.join(API_ROOT, relativePath), 'utf8').replace(/\r\n/g, '\n');
  return crypto.createHash('sha256').update(content).digest('hex');
}

function catalogFields() {
  return new Set(catalog.categories.flatMap((category) => [
    ...Object.keys(category.fields || {}),
    ...(category.requiredFields || []),
  ]));
}

function rulesById() {
  return new Map(catalog.categories.flatMap((category) => category.rules.map((rule) => [rule.id, rule])));
}

function conditionsFor(condition, field) {
  if (condition.any) return condition.any.flatMap((item) => conditionsFor(item, field));
  if (condition.all) return condition.all.flatMap((item) => conditionsFor(item, field));
  return condition.field === field ? [condition] : [];
}

test('conjunto tem 20 casos sintéticos com IDs únicos BV-01 a BV-20', () => {
  assert.equal(dataset.cases.length, 20);
  const ids = dataset.cases.map((item) => item.id);
  assert.deepEqual(ids, Array.from({ length: 20 }, (_, index) => `BV-${String(index + 1).padStart(2, '0')}`));
});

test('catálogo e motor continuam iguais à versão congelada no protocolo', () => {
  assert.equal(dataset.frozen.catalogVersion, catalog.catalogVersion);
  assert.equal(
    normalizedSha256('data/alert-rules.json'),
    dataset.frozen.catalogSha256,
    'alert-rules.json mudou: revise os casos, gere nova versão do conjunto e peça nova aprovação do protocolo'
  );
  assert.equal(
    normalizedSha256('services/riskEngine.js'),
    dataset.frozen.engineSha256,
    'riskEngine.js mudou: revise os casos, gere nova versão do conjunto e peça nova aprovação do protocolo'
  );
});

test('casos só usam campos do catálogo e passam na validação de entrada do motor', () => {
  const fields = catalogFields();
  for (const item of dataset.cases) {
    assert.deepEqual(Object.keys(item).sort(), ['id', 'input'], `${item.id}: só id e input`);
    for (const field of Object.keys(item.input)) {
      assert.ok(fields.has(field), `${item.id}: campo fora do catálogo: ${field}`);
    }
    assert.doesNotThrow(() => validateInput(item.input, catalog), item.id);
  }
});

test('cegamento: casos não trazem resultado esperado, regra-alvo nem gravidade', () => {
  const raw = JSON.stringify(dataset.cases);
  for (const forbidden of ['expected', 'severity', 'ruleId', 'alert', 'green', 'yellow', 'red', 'verde', 'amarelo', 'vermelho', 'type']) {
    assert.equal(raw.includes(`"${forbidden}"`), false, `casos não podem conter "${forbidden}"`);
  }
});

test('nenhum caso contém padrão de dado pessoal', () => {
  const raw = JSON.stringify(dataset);
  assert.equal(/[\w.+-]+@[\w-]+\.[\w.]+/.test(raw), false, 'e-mail');
  assert.equal(/\d{3}\.?\d{3}\.?\d{3}-?\d{2}/.test(raw), false, 'CPF');
  assert.equal(/\(?\d{2}\)?\s?9?\d{4}-?\d{4}/.test(raw), false, 'telefone');
  for (const key of ['name', 'nome', 'email', 'cpf', 'phone', 'telefone', 'address', 'endereco', 'birthdate']) {
    assert.equal(raw.includes(`"${key}"`), false, `campo pessoal: ${key}`);
  }
});

test('matriz de cobertura descreve todos os casos com a composição do protocolo', () => {
  assert.equal(coverage.datasetVersion, dataset.datasetVersion);
  assert.deepEqual(coverage.cases.map((item) => item.id), dataset.cases.map((item) => item.id));

  const counts = {};
  for (const item of coverage.cases) {
    assert.ok(Object.hasOwn(EXPECTED_TYPE_COUNTS, item.type), `${item.id}: tipo desconhecido ${item.type}`);
    counts[item.type] = (counts[item.type] || 0) + 1;
    if (item.type === 'normal') assert.equal(item.targets.length, 0, item.id);
    else assert.ok(item.targets.length > 0, `${item.id}: caso ${item.type} precisa de alvo`);
  }
  assert.deepEqual(counts, EXPECTED_TYPE_COUNTS);
});

test('casos cobrem as quatro regras vermelhas do catálogo', () => {
  const redRules = catalog.categories
    .flatMap((category) => category.rules)
    .filter((rule) => rule.severity === 'red')
    .map((rule) => rule.id)
    .sort();
  const targeted = new Set(
    coverage.cases.flatMap((item) => item.targets)
      .filter((target) => target.relation !== 'ausente')
      .map((target) => target.ruleId)
  );

  assert.equal(redRules.length, 4);
  for (const ruleId of redRules) {
    assert.ok(targeted.has(ruleId), `regra vermelha sem caso: ${ruleId}`);
  }
});

test('valores e limiares da matriz batem com os casos e com o catálogo', () => {
  const rules = rulesById();
  const inputs = new Map(dataset.cases.map((item) => [item.id, item.input]));

  for (const item of coverage.cases) {
    const input = inputs.get(item.id);
    for (const target of item.targets) {
      const label = `${item.id} ${target.ruleId}.${target.field}`;
      const rule = rules.get(target.ruleId);
      assert.ok(rule, `${label}: regra inexistente no catálogo`);
      assert.ok(conditionsFor(rule.when, target.field).length > 0, `${label}: campo não usado pela regra`);

      if (target.relation === 'ausente') {
        assert.equal(Object.hasOwn(input, target.field), false, `${label}: deveria estar ausente`);
        continue;
      }
      if (target.relation === 'contem') {
        assert.ok(input[target.field].includes(target.value), `${label}: sinal ausente no caso`);
        assert.ok(conditionsFor(rule.when, target.field).some((c) => c.value.includes(target.value)), `${label}: sinal fora da regra`);
        continue;
      }

      assert.equal(input[target.field], target.value, `${label}: valor diferente do caso`);
      if (target.relation === 'igual') continue;

      // Regras como a de IMC têm mais de um limiar no mesmo campo: vale o mais próximo.
      const threshold = conditionsFor(rule.when, target.field)
        .filter((c) => typeof c.value === 'number')
        .map((c) => c.value)
        .sort((left, right) => Math.abs(left - target.value) - Math.abs(right - target.value))[0];
      if (target.relation === 'no_limite') assert.equal(target.value, threshold, `${label}: não está no limiar`);
      else if (target.relation === 'abaixo_do_limite') assert.ok(target.value < threshold, `${label}: não está abaixo`);
      else if (target.relation === 'acima_do_limite') assert.ok(target.value > threshold, `${label}: não está acima`);
      else assert.fail(`${label}: relação desconhecida ${target.relation}`);
    }
  }
});

test('gabarito é um modelo vazio, separado da execução', () => {
  assert.equal(gabarito.status, 'nao_preenchido');
  assert.equal(gabarito.evaluator, null);
  assert.deepEqual(gabarito.cases.map((item) => item.id), dataset.cases.map((item) => item.id));
  for (const item of gabarito.cases) {
    assert.deepEqual(item, { id: item.id, classificacao: null, faltamDados: null, justificativa: null });
  }
  const raw = JSON.stringify(gabarito);
  for (const engineKey of ['overallSeverity', 'pending_data', 'ruleId', 'categories']) {
    assert.equal(raw.includes(engineKey), false, `gabarito não pode conter saída do motor: ${engineKey}`);
  }
});

test('ficha de classificação está sincronizada com os casos', (t) => {
  if (!fs.existsSync(SHEET_PATH)) {
    t.skip('docs/ não está disponível neste ambiente (ex.: imagem Docker da API).');
    return;
  }
  const sheet = fs.readFileSync(SHEET_PATH, 'utf8').replace(/\r\n/g, '\n');
  assert.equal(sheet, renderSheet(dataset), 'rode `node scripts/blindValidationSheet.js` em apps/api');
});
