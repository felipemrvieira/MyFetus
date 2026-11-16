# Roteiro do vídeo técnico — MyFetus v3.0.0

**Duração sugerida:** 6–10 minutos  
**Hospedagem:** YouTube não listado  
**Público:** nova equipe de desenvolvimento, avaliadores e PO  
**Fonte:** documentação técnica v3, ADRs, OpenAPI e CI/CD

Este roteiro prepara a gravação da issue #187. Ele orienta o que deve ser
explicado, mas não transforma uma decisão futura em decisão já aprovada. Onde o
sistema estiver parcial, o vídeo deve dizer “parcial” ou “dívida”.

## Estrutura

| Bloco | Conteúdo obrigatório | Evidência sugerida |
| --- | --- | --- |
| 0:00–0:40 | Escopo, perfis, ambiente acadêmico e limites de uso. | `README.md` e `docs/documentacao-tecnica-v3.md` quando #184 estiver mergeado. |
| 0:40–1:40 | Arquitetura mobile Expo/React Native, API Express, PostgreSQL, worker e integrações opcionais. | Diagrama da documentação e árvore do monorepo. |
| 1:40–2:40 | Fluxos clínicos: gestante, médico, documentos, exames, alertas, devolutiva e relatórios. | Rotas do `server.js`, OpenAPI e demo sintética. |
| 2:40–3:40 | Segurança: JWT/papéis/vínculo, AES-GCM, HMAC de lookup, sanitização, auditoria, CORS, HTTPS e rate limit. | `.env.example`, ADRs e arquivos de configuração sem valores secretos. |
| 3:40–4:40 | RAG: extração, chunking, embeddings, Pinecone/Gemini, citações, gate e comportamento quando a dependência está indisponível. | `docs/rag`, testes e manifesto; nunca exibir chave. |
| 4:40–5:40 | Banco e migrations: transação, `schema_migrations`, advisory lock, compatibilidade e reset local destrutivo. | `apps/api/scripts/migrate.js` e ER textual. |
| 5:40–6:40 | Testes e CI/CD: lint, API, raiz, Docker, CodeQL, auditoria, smoke e aprovação de staging. | `.github/workflows`, `docs/ci-cd.md` e saída dos checks. |
| 6:40–7:40 | Como executar localmente e como reproduzir a documentação/contratos. | `npm run setup`, `npm run dev:api`, `npm run dev:mobile`, `npm run docs:check`. |
| 7:40–fim | Lições, decisões, limitações, dívida e backlog 2027.1. | ADRs, release candidate e backlog triado. |

## Mensagens que não podem faltar

- a homologação não é produção e não deve receber dados reais;
- RAG, Gemini, Pinecone e push são dependências condicionais, não garantia de
  disponibilidade clínica;
- o chat é apoio à decisão e precisa de citação/limitação, nunca substitui o
  profissional;
- migrations são aplicadas pelo executor versionado, não por edição manual;
- a tag v3.0.0 só existe depois do freeze, CI/smoke verdes e aprovação do PO;
- achados do piloto são classificados P1/P2/P3; P1 aberto bloqueia beta;
- itens parciais e dívida técnica permanecem visíveis no release e no backlog.

## Checklist de validação do arquivo

- [ ] voz e tela identificam versão, SHA/revisão e ambiente;
- [ ] nenhum dado real, token, segredo ou valor de `.env` aparece;
- [ ] links exibidos apontam para arquivos/URLs acessíveis e versionados;
- [ ] comandos foram executados ou identificados como exemplo;
- [ ] decisões aprovadas estão separadas de perguntas em aberto;
- [ ] limitações e falhas conhecidas não foram omitidas;
- [ ] vídeo foi revisado integralmente antes de publicar como não listado;
- [ ] URL, duração, checksum opcional, SHA e aprovador foram anexados às
  issues #187 e #134.
