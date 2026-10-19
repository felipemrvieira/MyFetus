const path = require('path');

function argumentValue(name) {
  const prefix = `${name}=`;
  const argument = process.argv.find((value) => value.startsWith(prefix));
  return argument ? argument.slice(prefix.length) : undefined;
}

require('dotenv').config({
  path: process.env.ENV_FILE_PATH
    ? path.resolve(process.env.ENV_FILE_PATH)
    : path.resolve(__dirname, '../../../.env'),
});

if (argumentValue('--host')) process.env.PG_HOST = argumentValue('--host');
if (argumentValue('--port')) process.env.PG_PORT = argumentValue('--port');

const client = require('../backend');
const {
  getEncryptionStatus,
  migrateExistingData,
} = require('../services/dataEncryptionMigrationService');
const cryptoService = require('../services/cryptoService');

let isTerminating = false;

process.on('SIGINT', () => {
  if (isTerminating) {
    console.error('\nInterrupção forçada imediata.');
    process.exit(130);
  }
  isTerminating = true;
  console.log('\n[SIGINT recebido] Finalizando o lote em andamento com segurança...');
  console.log('O estado foi preservado. Os registros já comitados permanecem na nova versão.');
});

async function main() {
  const args = process.argv.slice(2);
  const showStatus = args.includes('--status');
  const execute = args.includes('--execute');
  const dryRun = !execute || args.includes('--dry-run');
  const stopOnError = args.includes('--stop-on-error');
  const batchSize = Number(argumentValue('--batch-size') || 100);
  const limit = Number(argumentValue('--limit') || 0);
  const table = argumentValue('--table');

  const currentVersion = cryptoService.getCurrentVersion();
  console.log(`=== Re-criptografia e Gestão do Keyring AES ===`);
  console.log(`Versão ativa da chave (AES_KEY_VERSION): ${currentVersion}`);
  console.log(`Modo: ${dryRun ? 'SIMULAÇÃO (--dry-run)' : 'EXECUÇÃO ATIVA (--execute)'}`);
  console.log(`Tamanho do lote: ${batchSize} | Limite total: ${limit || 'Ilimitado'}`);
  if (table) console.log(`Tabela selecionada: ${table}`);
  console.log('--------------------------------------------------');

  const initialStatus = await getEncryptionStatus(client, { table });
  console.log('Estado atual das tabelas classificadas:');
  console.table(initialStatus);

  if (showStatus) {
    return;
  }

  const startTime = Date.now();
  const summary = await migrateExistingData(client, {
    batchSize,
    dryRun,
    limit,
    stopOnError,
    table,
  });

  const durationSec = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log('\n=== Resultado da Operação ===');
  console.log(`Tempo decorrido: ${durationSec}s`);
  console.log(`Total de registros verificados: ${summary.scanned}`);
  console.log(`Total de registros re-criptografados: ${summary.migrated}`);
  console.log(`Total inalterado (já na versão atual): ${summary.unchanged}`);
  console.log(`Arquivos órfãos verificados: ${summary.orphanFilesScanned}`);
  console.log(`Erros encontrados: ${summary.errors.length}`);

  if (summary.errors.length > 0) {
    console.error('\nErros detalhados:');
    console.error(JSON.stringify(summary.errors, null, 2));
    process.exitCode = 1;
  }

  if (!dryRun && summary.migrated > 0) {
    console.log('\nEstado após migração:');
    const finalStatus = await getEncryptionStatus(client, { table });
    console.table(finalStatus);
  }
}

if (require.main === module) {
  main()
    .catch((error) => {
      console.error(`\nErro fatal durante a re-criptografia: ${error.message}`);
      process.exitCode = 1;
    })
    .finally(async () => {
      try {
        await client.end();
      } catch (_) {
        // Ignora erro no encerramento do pool.
      }
    });
}

module.exports = {
  main,
};
