/**
 * scripts/seed.js
 * Carga de dados iniciais para ambiente de desenvolvimento local do MyFetus.
 * Executado de forma idempotente e segura via npm run seed.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// 1. Carrega variaveis do .env na raiz do projeto
const rootEnvPath = path.resolve(__dirname, '../.env');
if (fs.existsSync(rootEnvPath)) {
  const envContent = fs.readFileSync(rootEnvPath, 'utf8');
  for (const line of envContent.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx > 0) {
      const key = trimmed.substring(0, eqIdx).trim();
      const val = trimmed.substring(eqIdx + 1).trim();
      if (!process.env[key]) {
        process.env[key] = val;
      }
    }
  }
}

// 2. Ajusta host e porta para conexao local a partir do host (fora do container)
if (process.env.PG_HOST === 'db' || !process.env.PG_HOST) {
  process.env.PG_HOST = process.env.DB_ROTATION_HOST || '127.0.0.1';
}
if (!process.env.PG_PORT || process.env.PG_PORT === '5432') {
  process.env.PG_PORT = process.env.DB_ROTATION_PORT || '5434';
}

const apiNodeModules = path.resolve(__dirname, '../apps/api/node_modules');
const pgPath = path.resolve(apiNodeModules, 'pg');
const bcryptPath = path.resolve(apiNodeModules, 'bcrypt');

let Pool;
let bcrypt;

try {
  Pool = require(pgPath).Pool;
} catch (e) {
  try {
    Pool = require('pg').Pool;
  } catch (err) {
    console.error('[ERRO] Modulo pg nao encontrado. Execute npm install antes do seed.');
    process.exit(1);
  }
}

try {
  bcrypt = require(bcryptPath);
} catch (e) {
  try {
    bcrypt = require('bcrypt');
  } catch (err) {
    console.error('[ERRO] Modulo bcrypt nao encontrado. Execute npm install na pasta apps/api.');
    process.exit(1);
  }
}

// Helper para HMAC do e-mail
function hashEmail(email) {
  const hmacKey = process.env.EMAIL_LOOKUP_HMAC_KEY;
  if (!hmacKey || hmacKey.length < 64) {
    return null;
  }
  return crypto
    .createHmac('sha256', Buffer.from(hmacKey, 'hex'))
    .update(email.trim().toLowerCase(), 'utf8')
    .digest('hex');
}

// Criptografia AES-256-GCM para campos sensiveis
function encryptValue(value, table, field) {
  const hexKey = process.env.AES_ENCRYPTION_KEY_V1;
  const version = Number(process.env.AES_KEY_VERSION || 1);
  if (!hexKey || hexKey.length !== 64 || value === null || value === undefined) {
    return value;
  }

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(hexKey, 'hex'), iv, {
    authTagLength: 16,
  });
  cipher.setAAD(Buffer.from(`myfetus:${table}:${field}`, 'utf8'));

  const serialized = JSON.stringify({ type: 'string', value: String(value) });
  const ciphertext = Buffer.concat([cipher.update(serialized, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `v${version}:${iv.toString('hex')}:${ciphertext.toString('hex')}:${authTag.toString('hex')}`;
}

async function runSeed() {
  console.log('[INFO] Iniciando verificacao e carga de dados de desenvolvimento...');

  const pool = new Pool({
    user: process.env.PG_USER || 'myfetus_app',
    password: process.env.PG_PASSWORD,
    database: process.env.PG_DATABASE || 'myfetus',
    host: process.env.PG_HOST,
    port: parseInt(process.env.PG_PORT, 10),
  });

  let client = null;

  try {
    try {
      client = await pool.connect();
    } catch (connErr) {
      if (connErr.code === 'ECONNREFUSED') {
        console.error(`[ERRO] Nao foi possivel conectar ao PostgreSQL em ${process.env.PG_HOST}:${process.env.PG_PORT} (conexao recusada).`);
        console.error(`[INFO] O container do banco nao esta em execucao.`);
        console.error(`[INFO] Para subir o banco e rodar a carga completa, execute: npm run setup`);
        console.error(`[INFO] Para apenas subir o container do banco: npm run docker:up`);
        process.exit(1);
      }
      throw connErr;
    }

    const saltRounds = 10;
    const defaultPassword = 'SenhaTeste123!';
    const hashedPassword = await bcrypt.hash(defaultPassword, saltRounds);

    // 1. Gestante de Teste
    const gestanteEmail = 'teste_gestante@myfetus.com';
    const gestanteHmac = hashEmail(gestanteEmail);

    let gestanteUser = null;
    if (gestanteHmac) {
      const res = await client.query('SELECT id FROM users WHERE email_lookup_hash = $1', [gestanteHmac]);
      if (res.rows.length > 0) gestanteUser = res.rows[0];
    }

    if (!gestanteUser) {
      const encName = encryptValue('Paciente de Teste', 'users', 'name');
      const encEmail = encryptValue(gestanteEmail, 'users', 'email');
      const encBirthdate = encryptValue('1995-05-15', 'users', 'birthdate');

      const userInsert = await client.query(
        `INSERT INTO users (
           name, email, password, birthdate, role, is_active,
           email_lookup_hash, encryption_key_version
         )
         VALUES ($1, $2, $3, $4, 'gestante', true, $5, 1)
         RETURNING id`,
        [encName, encEmail, hashedPassword, encBirthdate, gestanteHmac]
      );
      const userId = userInsert.rows[0].id;

      await client.query('INSERT INTO pregnants (user_id) VALUES ($1) ON CONFLICT DO NOTHING', [userId]);
      console.log(`[OK] Gestante de teste criada: ${gestanteEmail} (ID: ${userId})`);
    } else {
      console.log(`[INFO] Gestante de teste ja existente: ${gestanteEmail}`);
    }

    // 2. Medico de Teste
    const medicoEmail = 'medico_teste@myfetus.com';
    const medicoHmac = hashEmail(medicoEmail);

    let medicoUser = null;
    if (medicoHmac) {
      const res = await client.query('SELECT id FROM users WHERE email_lookup_hash = $1', [medicoHmac]);
      if (res.rows.length > 0) medicoUser = res.rows[0];
    }

    if (!medicoUser) {
      const encName = encryptValue('Dr. Medico de Teste', 'users', 'name');
      const encEmail = encryptValue(medicoEmail, 'users', 'email');
      const encBirthdate = encryptValue('1980-01-10', 'users', 'birthdate');

      const userInsert = await client.query(
        `INSERT INTO users (
           name, email, password, birthdate, role, is_active,
           email_lookup_hash, encryption_key_version
         )
         VALUES ($1, $2, $3, $4, 'medico', true, $5, 1)
         RETURNING id`,
        [encName, encEmail, hashedPassword, encBirthdate, medicoHmac]
      );
      const doctorUserId = userInsert.rows[0].id;

      const encCrm = encryptValue('123456', 'doctors', 'crm');
      const encCrmUf = encryptValue('PE', 'doctors', 'crm_estado');
      const encTelefone = encryptValue('81999998888', 'doctors', 'telefone');

      await client.query(
        `INSERT INTO doctors (
           user_id, crm, crm_estado, telefone, especialidade,
           encryption_key_version
         )
         VALUES ($1, $2, $3, $4, 'Obstetricia', 1)
         ON CONFLICT DO NOTHING`,
        [doctorUserId, encCrm, encCrmUf, encTelefone]
      );
      console.log(`[OK] Medico de teste criado: ${medicoEmail} (ID: ${doctorUserId})`);
    } else {
      console.log(`[INFO] Medico de teste ja existente: ${medicoEmail}`);
    }

    // 3. Admin de Teste
    const adminEmail = 'admin_teste@myfetus.com';
    const adminHmac = hashEmail(adminEmail);

    let adminUser = null;
    if (adminHmac) {
      const res = await client.query('SELECT id FROM users WHERE email_lookup_hash = $1', [adminHmac]);
      if (res.rows.length > 0) adminUser = res.rows[0];
    }

    if (!adminUser) {
      const encName = encryptValue('Administrador Local', 'users', 'name');
      const encEmail = encryptValue(adminEmail, 'users', 'email');
      const encBirthdate = encryptValue('1985-03-20', 'users', 'birthdate');

      const userInsert = await client.query(
        `INSERT INTO users (
           name, email, password, birthdate, role, is_active,
           email_lookup_hash, encryption_key_version
         )
         VALUES ($1, $2, $3, $4, 'admin', true, $5, 1)
         RETURNING id`,
        [encName, encEmail, hashedPassword, encBirthdate, adminHmac]
      );
      console.log(`[OK] Administrador de teste criado: ${adminEmail} (ID: ${userInsert.rows[0].id})`);
    } else {
      console.log(`[INFO] Administrador de teste ja existente: ${adminEmail}`);
    }

    console.log('[OK] Carga de dados (seeds) finalizada com sucesso.');
  } catch (err) {
    console.error('[ERRO] Falha ao executar seeds:', err.message);
    process.exit(1);
  } finally {
    if (client) {
      client.release();
    }
    await pool.end();
  }
}

runSeed();
