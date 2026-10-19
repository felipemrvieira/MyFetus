import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildSignupConsents, getApiErrorInfo, parseConsentPolicy } from '../utils/consent';

const apiPolicy = {
  purposes: [
    { purpose: 'termos_e_privacidade', title: 'Termo', version: '0.1-rascunho', required: true, text: 'Texto' },
    { purpose: 'pesquisa', title: 'Pesquisa', version: '1', required: false, text: 'Opcional' },
  ],
};

describe('consentimento no cadastro', () => {
  it('aceita a política vinda da API e rejeita formatos inválidos', () => {
    assert.deepEqual(parseConsentPolicy(apiPolicy), apiPolicy);
    assert.equal(parseConsentPolicy({ purposes: [] }), null);
    assert.equal(parseConsentPolicy({ purposes: [{ purpose: 'x' }] }), null);
    assert.equal(parseConsentPolicy(null), null);
  });

  it('envia apenas as finalidades obrigatórias, na versão vigente recebida', () => {
    assert.deepEqual(buildSignupConsents(apiPolicy), [
      { purpose: 'termos_e_privacidade', version: '0.1-rascunho' },
    ]);
  });

  it('lê status, código e mensagem do erro da API (axios)', () => {
    const outdated = { response: { status: 409, data: { error: 'Versão desatualizada', code: 'CONSENT_VERSION_OUTDATED' } } };
    assert.deepEqual(getApiErrorInfo(outdated), { status: 409, code: 'CONSENT_VERSION_OUTDATED', message: 'Versão desatualizada' });
    assert.deepEqual(getApiErrorInfo(new Error('Network Error')), { status: null, code: null, message: null });
  });
});
