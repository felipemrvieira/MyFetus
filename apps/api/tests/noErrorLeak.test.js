const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const apiDir = path.join(__dirname, '..');
const dirs = ['controllers', 'routes'].map((dir) => path.join(apiDir, dir));

// res.json({ ... chave: err.message ... }) expõe o erro ao cliente.
// Respostas clínicas podem ter um campo legítimo chamado `message`; o teste
// deve identificar somente variáveis de erro, não qualquer objeto.message.
// Logger e audit não usam .json(, então não são afetados.
const leakPattern = /\.json\(\s*\{[^}]*\b\w+\s*:\s*(?:err|error|exception|caught)\.message/;

// Mensagens de validação escritas pela própria aplicação (400), revisadas manualmente.
const ALLOWED_VALIDATION_MESSAGES = new Set([
  'clinicalHistoryController.js',
  'growthPercentileController.js', // só devolve message de GrowthValidationError; demais erros viram 500 genérico
]);

test('respostas HTTP não devolvem err.message', () => {
  const offenders = [];
  for (const dir of dirs) {
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.js'))) {
      if (ALLOWED_VALIDATION_MESSAGES.has(file)) continue;
      if (leakPattern.test(fs.readFileSync(path.join(dir, file), 'utf8'))) {
        offenders.push(path.basename(dir) + '/' + file);
      }
    }
  }
  assert.deepEqual(offenders, [], `Arquivos que expõem err.message na resposta: ${offenders.join(', ')}`);
});
