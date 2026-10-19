/**
 * Política de consentimento (E7-01.1, issue #143).
 *
 * Fonte única das finalidades que exigem aceite, da versão vigente de cada
 * termo e do texto exibido no cadastro. Alterar `version` faz todo aceite
 * anterior ficar desatualizado (novo aceite exigido).
 *
 * RASCUNHO: finalidades, texto, versão e papéis obrigados aguardam aprovação do
 * P.O./orientação jurídica (ver docs/lgpd/consentimento.md).
 */
const CONSENT_DECISIONS = Object.freeze(['accepted', 'refused', 'revoked']);

// Papéis que precisam de consentimento vigente. Médicos/admin: decisão pendente do P.O.
const CONSENT_REQUIRED_ROLES = Object.freeze(['gestante']);

const TERMS_DRAFT_TEXT = [
  'RASCUNHO - texto aguardando aprovação do Product Owner e orientação jurídica.',
  '',
  'O MyFetus é um projeto acadêmico da POLI/UPE, em desenvolvimento e validação clínica. Ele não substitui consulta, diagnóstico ou atendimento de emergência.',
  '',
  'Dados tratados: nome, e-mail, data de nascimento e as informações de acompanhamento pré-natal que você ou o profissional vinculado registrarem, incluindo documentos de exames.',
  '',
  'Finalidade: permitir o acompanhamento da sua gestação no aplicativo e o acesso do profissional de saúde vinculado a você.',
  '',
  'Proteção: dados sensíveis são criptografados em repouso, o acesso é restrito ao seu perfil e aos profissionais vinculados, e as operações ficam registradas em trilha de auditoria. Perguntas enviadas à inteligência artificial passam por remoção de dados pessoais antes do processamento.',
  '',
  'Seus direitos: você pode revogar este consentimento a qualquer momento e solicitar acesso, correção, exportação ou exclusão dos seus dados.',
].join('\n');

const CONSENT_PURPOSES = Object.freeze({
  termos_e_privacidade: Object.freeze({
    title: 'Termo de uso e política de privacidade',
    version: '0.1-rascunho',
    required: true,
    text: TERMS_DRAFT_TEXT,
  }),
});

function getPurpose(purpose) {
  return Object.prototype.hasOwnProperty.call(CONSENT_PURPOSES, purpose)
    ? CONSENT_PURPOSES[purpose]
    : null;
}

function getRequiredPurposes() {
  return Object.entries(CONSENT_PURPOSES)
    .filter(([, config]) => config.required)
    .map(([purpose, config]) => ({ purpose, version: config.version }));
}

module.exports = {
  CONSENT_DECISIONS,
  CONSENT_PURPOSES,
  CONSENT_REQUIRED_ROLES,
  getPurpose,
  getRequiredPurposes,
};
