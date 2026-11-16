# ADR 0007 — Serviços externos de custo zero ou patrocinados no ciclo acadêmico

## Contexto

O ciclo atual precisa manter a homologação e a demonstração acadêmica com custo
controlado. O MyFetus possui integrações opcionais com serviços externos para
RAG, geração de respostas e notificações, mas não deve transformar uma conta
pessoal ou uma cota gratuita em dependência silenciosa de produção.

## Decisão

No ciclo acadêmico, usar somente planos gratuitos, créditos patrocinados ou
recursos locais para demonstração. As integrações externas permanecem
configuráveis por ambiente, com chaves fora do repositório, limites de uso e
comportamento explícito de indisponibilidade.

- o PostgreSQL local e os embeddings locais são o caminho padrão de desenvolvimento;
- Pinecone, Gemini e Expo Push só são ativados quando houver credencial e cota
  aprovadas para o ambiente;
- uma cota esgotada não deve ser contornada com credencial pessoal nem ocultada
  como sucesso clínico;
- o deploy de homologação usa os recursos GCP documentados, com custo limitado
  e sem dados reais;
- qualquer mudança para serviço pago, uso produtivo ou aumento de cota exige
  nova decisão registrada.

## Consequências

As demos permanecem reproduzíveis com dados sintéticos e dependências locais.
Recursos RAG, geração e push podem ficar indisponíveis ou degradados sem
comprometer o núcleo cadastral/gestacional. O time precisa monitorar quota,
documentar indisponibilidade e evitar prometer disponibilidade de produção.

## Pergunta para confirmação

**Pergunta:** existe orçamento ou patrocínio aprovado para manter as integrações
externas após a homologação?  
**Sugestão de resposta:** até nova aprovação, manter o escopo em recursos
gratuitos/patrocinados e não usar dados reais; registrar o provedor, cota,
responsável e prazo de revisão antes de habilitar um ambiente produtivo.
