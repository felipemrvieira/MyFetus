/**
 * Textos da tela Sobre (E7-09, issue #115).
 *
 * RASCUNHO: todos os textos aguardam aprovação do P.O. (nome da equipe e
 * instituição, contato oficial, limitações, avisos legais e links de termos e
 * privacidade). Base usada: "descrição para fins acadêmicos" do Sprint 0 e os
 * princípios de LGPD, ética e validação clínica do documento do ciclo 2026.2.
 *
 * Regras desta tela:
 *   - Não listar nomes de integrantes sem autorização.
 *   - Não exibir URL da API, ambiente, IDs de build ou qualquer segredo.
 */
export type AboutSection = {
  id: string;
  title: string;
  paragraphs: string[];
};

export const ABOUT_IS_DRAFT = true;

export const ABOUT_DRAFT_NOTICE =
  'Rascunho: textos aguardando aprovação do Product Owner.';

export const ABOUT_SECTIONS: readonly AboutSection[] = [
  {
    id: 'projeto',
    title: 'O que é o MyFetus',
    paragraphs: [
      'O MyFetus é um projeto acadêmico concebido pelo Dr. Rui Nóbrega, médico obstetra e Product Owner, ' +
        'desenvolvido na disciplina de Engenharia de Software da Escola Politécnica de Pernambuco (POLI/UPE).',
      'O aplicativo apoia o acompanhamento pré-natal, conectando a gestante ao profissional de saúde que a acompanha.',
    ],
  },
  {
    id: 'nao-substitui',
    title: 'O MyFetus não substitui atendimento médico',
    paragraphs: [
      'As informações do aplicativo não substituem consulta, diagnóstico, prescrição ou atendimento de emergência.',
      'Em caso de sinais de alarme, como sangramento, perda de líquido, dor de cabeça forte com visão turva, ' +
        'convulsão, desmaio ou diminuição dos movimentos do bebê, procure imediatamente um serviço de urgência ' +
        'ou ligue 192 (SAMU).',
    ],
  },
  {
    id: 'limitacoes',
    title: 'Limitações',
    paragraphs: [
      'Projeto acadêmico em desenvolvimento e ainda em validação clínica.',
      'Durante o ciclo atual, o sistema usa apenas dados sintéticos (fictícios). Não cadastre dados reais de pacientes.',
      'Respostas geradas por inteligência artificial são apoio informativo baseado em diretrizes oficiais e podem conter erros.',
      'Alertas de risco apoiam a decisão do profissional de saúde; não são decisão clínica.',
    ],
  },
  {
    id: 'equipe',
    title: 'Equipe',
    paragraphs: [
      'Equipe de Engenharia de Software da POLI/UPE, ciclo 2026.2.',
      'Os nomes dos integrantes serão exibidos após autorização.',
    ],
  },
  {
    id: 'contato',
    title: 'Contato',
    paragraphs: ['Canal oficial de contato em definição com o Product Owner.'],
  },
  {
    id: 'termos',
    title: 'Termos de uso e privacidade',
    paragraphs: [
      'Os termos de uso e a política de privacidade estão em elaboração e serão disponibilizados nesta tela.',
    ],
  },
];
