# Citações e fontes no chat (E4-04)

Issue: #130. Depende da E4-03 (#128, caminho único de retrieval), já concluída.

## O que muda

- `POST /api/internal/rag/chat` devolve `citacoes`: uma por trecho enviado ao modelo, na mesma
  ordem dos números `[1]`, `[2]`... do contexto. O prompt pede para a resposta citar esses números.
- Cada citação traz documento (`documento_id`, título, órgão, edição, ano), página ou seção, um
  trecho curto e o link oficial do manifesto. O score técnico (`relevancia`) não aparece.
- No app, cada resposta do assistente ganha o botão **Ver N fontes**, que abre a lista com
  documento, local e trecho, e um link para o documento oficial.
- `fontes` continua na resposta, no formato antigo, para não quebrar quem já usa.
- `POST /api/internal/rag/chat/agents` também devolve `citacoes`, a partir das fontes usadas
  pelos agentes.

## Regras

| Regra | Como funciona |
|---|---|
| Fonte rastreável | Só vira citação, e só vai ao modelo, o trecho com texto, documento do manifesto e página ou seção. |
| Sem fonte | Se nenhum trecho for rastreável, o modelo **não é chamado** e a resposta é a orientação padrão (`SAFE_MESSAGES.no_source`), com `sem_fonte: true`. |
| Página | Quando o trecho não tem página, a citação mostra só a seção. A página nunca é inventada. |
| Trecho | No máximo 280 caracteres, cortado no fim de uma palavra (`MAX_SNIPPET_CHARS`). |
| Link | Só `https`. Qualquer outro esquema é descartado. |
| Fonte = chunk usado | As citações são montadas a partir da mesma lista de trechos enviada ao modelo. |

## Auditoria

`RAG_CHAT_QUERIED` passa a registrar, sem o texto dos trechos:

- documento, página e seção de cada citação;
- quantos trechos foram descartados por não serem rastreáveis;
- se a resposta saiu sem fonte;
- versões do manifesto, modelo (`GEMINI_MODEL`) e versão do prompt (`RAG_CHAT_PROMPT_VERSION`).

## Decisões pendentes do P.O.

As perguntas feitas na #130 em 27/10 ainda não têm resposta. A implementação segue as sugestões
registradas lá e deixa cada ponto fácil de ajustar:

| # | Pergunta | O que está implementado | Onde ajustar |
|---|---|---|---|
| 1 | Tamanho do trecho | 280 caracteres | `MAX_SNIPPET_CHARS` em `ragCitationService.js` |
| 2 | Identificação | Título, órgão, edição, ano, página, seção e link oficial | `buildCitation` e `utils/chatCitations.ts` |
| 3 | Score | Oculto | `buildCitation` |
| 4 | Fonte parcial | Aceita, desde que rastreável | `isTraceable` |
| 5 | PDF sem página | Usa a seção; sem página e sem seção, o trecho é descartado | `isTraceable` |
| 6 | Gestante x médico | Mesmo nível de fonte para os dois (só metadados públicos do manifesto) | `ChatSources.tsx` |
| 7 | Mensagem sem fonte | A já existente: "Não encontrei isso nas fontes aprovadas. Converse com seu médico." | `SAFE_MESSAGES.no_source` |

## Testes

- `apps/api/tests/ragCitations.test.js` (no `test:ci`):
  - metadados da busca;
  - ordem e formato das citações, sem score;
  - corte do trecho;
  - rastreabilidade e link só `https`;
  - citações iguais aos trechos enviados ao modelo;
  - fallback sem chamar o modelo;
  - auditoria sem o texto.
- `apps/mobile/tests/chatCitations.test.ts`: rótulos, identificação, página opcional, texto do
  leitor de tela e link.
