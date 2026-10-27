#!/usr/bin/env node

const fs = require('node:fs');

const apiUrl = (process.env.E2E_API_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
const reportPath = process.env.E2E_SAFETY_REPORT_PATH;

async function request(path, options = {}) {
  const response = await fetch(`${apiUrl}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: response.status, body, raw: text };
}

async function main() {
  const login = await request('/api/users/login', {
    method: 'POST',
    body: JSON.stringify({
      email: process.env.E2E_DOCTOR_EMAIL,
      password: process.env.E2E_PASSWORD,
    }),
  });
  if (login.status !== 200 || !login.body?.token) {
    throw new Error(`login sintético falhou com HTTP ${login.status}`);
  }

  const authorization = { authorization: `Bearer ${login.body.token}` };
  const forbidden = await request(`/api/pregnants/${process.env.E2E_OTHER_PREGNANT_ID}`, {
    headers: authorization,
  });
  if (forbidden.status !== 403 || forbidden.raw.includes('Outra Gestante E2E Sintética')) {
    throw new Error(`isolamento A/B não confirmado: HTTP ${forbidden.status}`);
  }

  // ID malformado força erro de backend; o contrato seguro não pode expor SQL,
  // stack trace, caminho local ou segredo para o cliente.
  const malformed = await request('/api/pregnants/not-a-number', {
    headers: authorization,
  });
  const unsafeLeak = /stack|syntax error|postgres|node_modules|\/home\/runner|secret|token/i.test(malformed.raw);
  if (malformed.status < 400 || unsafeLeak) {
    throw new Error(`falha segura da API não confirmada: HTTP ${malformed.status}`);
  }

  const report = {
    generatedAt: new Date().toISOString(),
    checks: {
      crossPatientIsolation: { status: 'passed', httpStatus: forbidden.status },
      safeApiFailure: { status: 'passed', httpStatus: malformed.status },
    },
  };
  const output = `${JSON.stringify(report, null, 2)}\n`;
  if (reportPath) fs.writeFileSync(reportPath, output, 'utf8');
  process.stdout.write(output);
}

main().catch((error) => {
  console.error(`Falha na validação de segurança do smoke: ${error.message}`);
  process.exitCode = 1;
});
