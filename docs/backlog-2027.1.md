# Backlog triado — 2027.1

Este backlog é a triagem solicitada para a release v3.0.0. Ele não fecha issues
sem entrega: itens não implementados permanecem abertos ou são criados com o
mesmo contexto, dependências e dono a definir pelo PO.

| Prioridade | Item | Estado atual | Dependências / critério de pronto |
| --- | --- | --- | --- |
| P0 | Produção | Não iniciado | arquitetura de produção, domínio/HTTPS, observabilidade, backup/restore, gestão de segredos, aprovação de segurança e dados reais somente após autorização institucional. |
| P0 | RNDS | Não iniciado | escopo e credenciais institucionais, mapeamento de interoperabilidade, consentimento, auditoria e testes de contrato; não assumir conformidade antes de validação formal. |
| P1 | Papel de enfermagem (#113) | Bloqueado por decisão de negócio | matriz de permissões, leitura mínima necessária, auditoria e aprovação do PO; backlog já indicado para 2027.1. |
| P1 | Assinatura digital | Não iniciado | decisão sobre provedor, identidade, validade jurídica, carimbo/auditoria e fluxo de revogação. |
| P1 | Achados do piloto (#72/#73/#183) | Aguardando execução/parecer | classificar P1/P2/P3; corrigir somente após decisão e novo ciclo de validação; registrar achados pós-freeze sem reabrir o build automaticamente. |
| P1 | Dívida de consulta (#135) | Em aberto | definir contrato do PDF, conteúdo mínimo, autorização, testes e evidência de geração/visualização. |
| P1 | Push efetivo (#132) | Parcial | confirmar opt-in, provedor, consentimento, retry, revogação, observabilidade e teste em dispositivo. |
| P1 | Fontes e operação RAG | Parcial/condicionado | aprovar manifesto de fontes, política de atualização, quota/custo, fallback, métricas de citação e revisão clínica. |
| P2 | Relato científico/pesquisa (#116) | Fora do ciclo atual | avaliar CEP antes de qualquer pesquisa com participantes; definir protocolo, dados, consentimento e autoria. |
| P2 | Testes de integração/E2E e carga | Parcial | priorizar fluxos críticos, ambiente efêmero, dados sintéticos, smoke automatizado e critério de cobertura. |
| P2 | Observabilidade | Parcial | métricas, tracing, alertas, retenção e dashboards para API, worker, migrations e integrações externas. |

## Regras de triagem

- **P0:** bloqueia o próximo release ou envolve risco operacional/regulatório;
- **P1:** necessário para uma capacidade de negócio ou segurança relevante;
- **P2:** melhoria importante, mas com workaround seguro;
- **P3:** cosmético ou otimização sem impacto na jornada crítica.

Cada issue nova deve informar: objetivo, critério de aceite, dependências,
responsável, dados permitidos, evidência esperada e pergunta/sugestão de resposta
quando houver decisão do PO. Nenhum item clínico deve ser fechado apenas por
documentação; a evidência deve indicar implementação, teste e revisão cabíveis.

## Perguntas e sugestões de resposta

**Pergunta:** produção e RNDS entram como um único épico?  
**Sugestão de resposta:** separar em épicos, porque produção é infraestrutura e
operação, enquanto RNDS é interoperabilidade e conformidade; relacioná-los por
dependências, sem bloquear a definição inicial de escopo.

**Pergunta:** o que significa “entregue” na release?  
**Sugestão de resposta:** código mergeado, evidência de testes adequada ao risco,
documentação/contrato atualizado e validação no ambiente definido; item parcial
ou apenas planejado permanece nessa condição nas notas.

**Pergunta:** quando um achado do piloto vira correção?  
**Sugestão de resposta:** depois da classificação P1/P2/P3 e da confirmação do
PO; P1 bloqueia beta, P2 pode ter workaround documentado e P3 pode aguardar o
backlog.

**Pergunta:** quem será responsável pelos itens sem dono?  
**Sugestão de resposta:** o PO define o responsável na abertura/replanejamento;
até lá, manter o item triado, sem atribuir execução por inferência.
