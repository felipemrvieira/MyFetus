# DPIA simplificada e registro de riscos de privacidade — MyFetus

> **Task:** E7-04.1 (subtask de #69) · **Dependências:** #50, #56, #114
> **Status:** RASCUNHO v0.8 — não marcar como concluída antes da revisão e do aceite do P.O.

| Campo | Valor |
| --- | --- |
| Versão | 1.0 |
| Data | 19/10/2026 |
| Autor(es) | João Guilherme |
| Revisor (P.O.) | |
| Status da revisão | Pendente |

## Legenda

- **[CONFIRMADO]**: verificado no código, nas migrations, no banco em execução, nos testes ou confirmado pelo P.O. (a evidência vem entre parênteses).
- **[SUPOSIÇÃO]**: não confirmado; deve constar também na seção 8.
- **[PENDENTE-PO]**: decisão que depende do P.O.
- **[A VERIFICAR]**: depende de arquivo ou teste ainda não analisado.

**Fontes analisadas:** schema base, migrations (Sprints 1, 3, 6, AES, segurança de documentos, security baseline, audit trail), `init.sql`, `docker-compose.yml`, estado real do banco local (`\d`, após `db:migrate`), `package.json`, e no backend: `server.js`, `config/dataClassification.js`, `config/security.js`, `middlewares/auth.js`, `middlewares/authRateLimit.js`, `utils/clinicalAccess.js`, `utils/logger.js`, `utils/piiSanitizer.js`, `utils/ragRetrieval.js`, rotas (`users`, `doctors`, `pregnants`, `documents`, `doctorPatientLinks`, `rag`, `agent`, `growth`, `clinicalHistory`, `medicoes`), controllers (`user`, `pregnant`, `documents`, `doctorPatientLink`, `rag`, `agent`), serviços (`cryptoService`, `fileCryptoService`, `auditService`, `clinicalDataService`, `documentExtractionWorker`, `generationService`, `embeddingService`, `ragIngestionService`, agentes e `clinicalGraph`), `utils/userPolicy.js`, `middlewares/userAccess.js`, `controllers/doctorController.js`, `controllers/clinicalHistoryController.js`, `services/pdfTextExtractor.js` (extração/OCR), `routes/audit.js`, `routes/sync.js`, `routes/pregnancies.js`, `routes/pregnancyEvents.js`, `routes/health.js`, `controllers/auditController.js`, `controllers/syncController.js`, `controllers/pregnancyController.js`, `controllers/pregnancyEventsController.js`, `services/clinicalHistoryService.js`, `services/healthService.js`.

**Ainda não analisados:** `utils/syncPolicy.js`, `routes/docs.js`, trecho de download de `controllers/documentsController.js` (cabeçalhos), `trust proxy`/`helmet` em `server.js`, scripts `.js` que possam criar o primeiro admin, o comportamento de download dos dados de idioma do `tesseract.js` (versão ^6.0.1), app mobile (inclusive o `document_type` que ele envia), e como recuperar ou reconfigurar `AES_ENCRYPTION_KEY_V1` (ver R06)

**Execução dos testes (máquina do desenvolvedor, banco local):**

| Comando | Resultado | Observação |
| --- | --- | --- |
| `npm run test:ci` | **Passou** (código 0) | Cobre `piiSanitizer`, `logger`, `cryptoService`, `fileCryptoService`, `securityBaseline`, `crossPatientAuthorization`, `clinicalDataService`, `emailLookupService`, `generationService`, `openapiContract`, worker de documentos |
| `test:pii`, `test:logger`, `test:crypto`, `test:file-crypto`, `test:clinical-crypto`, `test:security-baseline` | **Passaram** (código 0 em cada um) | Execução individual |
| `npm run test:transport-security` | **Passou** (com o `.env` carregado) | Saída: "HTTPS e rate limiting validados". A primeira tentativa falhou só por `PG_USER` ausente no ambiente |
| `npm run aes:migrate:dry-run` | **Não concluiu** (código 1), mesmo após carregar o `.env` | Conectou ao banco e varreu 5 registros (2 usuários, 1 médico, 1 gestante com as colunas classificadas vazias [CONFIRMADO: consulta SQL], 1 documento), mas falhou em todos por `AES_ENCRYPTION_KEY_V1 nao configurada`; a variável `AES_ENCRYPTION_KEY_V1` existe, mas está **vazia** (0 caracteres) no `.env` e no contêiner da API (ver R06). A contagem de legados foi obtida por consulta SQL (ver R11) |

---

## 1. Escopo e contexto

- Sistema: MyFetus, app mobile (Expo/React Native), API Node.js/Express, PostgreSQL 15 (Docker), extração de texto de documentos e chat clínico com RAG.
- Titulares: gestantes, médicos/profissionais de saúde, administradores. O feto/recém-nascido aparece nos dados (biometria, nascidos vivos/mortos), mas não é usuário.
- Natureza do tratamento: dados pessoais e **dados pessoais sensíveis de saúde** (LGPD, art. 5º, II), incluindo HIV/AIDS, sífilis, toxoplasmose, uso de álcool/tabaco/drogas, perdas gestacionais e informações psicossociais.
- Terceiros: **Google Gemini** recebe a pergunta, semanas de gestação e eventos em texto livre (ver 3.4); **Pinecone** guarda apenas diretrizes públicas e recebe vetores de consulta. Embeddings são gerados localmente (`Xenova/multilingual-e5-small`) [CONFIRMADO: `embeddingService.js`, `ragIngestionService.js`, `generationService.js`].
- Ambiente: desenvolvimento/acadêmico, sem produção [CONFIRMADO: README]. Os riscos valem para uso com dados reais.
- Fora de escopo: _(preencher)_

## 2. Inventário de dados

"AES" = coluna convertida para `TEXT` para guardar envelope AES-256-GCM `vN:iv:cipher:tag` e listada em `ENCRYPTED_FIELDS` [CONFIRMADO: `\d`, `dataClassification.js`, `cryptoService.js`]. No banco local, a contagem de registros legados em texto plano foi medida por consulta SQL: nenhum (ver R11). Em outros ambientes ainda não foi medida.

| ID | Dado | Tabela.colunas | Titular | Classificação | Finalidade (proposta) | Base legal | Quem acessa | Proteção em repouso | Retenção |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| D01 | Identificação | `users.name`, `email`, `birthdate` | Todos | Pessoal | Cadastro e autenticação | [SUPOSIÇÃO] | Próprio usuário; **admin lista todos (`GET /users`)**; médico via busca por e-mail (R03); `birthdate` vai ao Gemini no `/agent/maternal-analysis`; médico vinculado lê e edita name e birthdate via /users/:id (requireUserAccess, userPolicy) | AES; `email_lookup_hash` HMAC-SHA-256 (índice único); `email` sem UNIQUE | [PENDENTE-PO] |
| D02 | Credencial e perfil | `users.password`, `role`, `is_active` | Todos | Pessoal | Autenticação/autorização | [SUPOSIÇÃO] | API | `password` com bcrypt (10 rounds) [CONFIRMADO: `userController.js`, `HASHED_FIELDS`]; `role`/`is_active` em claro | [PENDENTE-PO] |
| D03 | Perfil profissional | `doctors.crm`, `crm_estado`, `telefone`, `especialidade` | Médico | Pessoal | Identificação profissional | [SUPOSIÇÃO] | Admin | AES em crm/crm_estado/telefone; `especialidade` em claro | [PENDENTE-PO] |
| D04 | Antropometria e sinais vitais | `pregnants.altura`, `peso_*`, `temperatura_materna`, `pressao_*` | Gestante | **Sensível (saúde)** | Pré-natal | [SUPOSIÇÃO] | Médico vinculado; admin | AES | [PENDENTE-PO] |
| D05 | Antecedentes | `pregnants.antecedentes_*`, `antecedentes_clinicos_*` (inclui textos livres) | Gestante | **Sensível (saúde)** | Estratificação de risco | [SUPOSIÇÃO] | Médico vinculado; admin | AES | [PENDENTE-PO] |
| D06 | Histórico obstétrico | `pregnants.gestacao_*` | Gestante | **Sensível (saúde)**; perdas gestacionais | Estratificação de risco | [SUPOSIÇÃO] | Médico vinculado; admin | AES | [PENDENTE-PO] |
| D07 | Gestação atual: hábitos e infecções | `pregnants.gestacao_atual_*` (fumante, álcool, drogas, HIV/AIDS, sífilis, toxoplasmose etc.), `exantema_rash` | Gestante | **Sensível (saúde) — impacto muito alto** | Acompanhamento | [SUPOSIÇÃO] | Médico vinculado; admin. **Não vai ao Gemini** no código atual [CONFIRMADO: `buildPatientContext`] | AES | [PENDENTE-PO] |
| D08 | Vacinas | `pregnants.vacina_*` | Gestante | **Sensível (saúde)** | Acompanhamento | [SUPOSIÇÃO] | Médico vinculado; admin | AES | [PENDENTE-PO] |
| D09 | Informações gerais e psicossociais | `pregnants.info_gerais_*` (texto livre) | Gestante | **Sensível (saúde/psicossocial)** | Avaliação clínica | [SUPOSIÇÃO] | Médico vinculado; admin | AES | [PENDENTE-PO] |
| D10 | Dados da gestação | `pregnancies.weeks`, `dum`, `dpp`, `ccn`, `dgm`, `glicemia`, `frequencia_cardiaca`, `altura_uterina`, `regularidade_do_ciclo`, `ig_ultrassonografia`, `is_checked` | Gestante | **Sensível (saúde)** | Acompanhamento | [SUPOSIÇÃO] | Gestante; médico vinculado; **semanas vão ao Gemini** | AES | [PENDENTE-PO] |
| D11 | Eventos gestacionais | `pregnancy_events.descricao` (texto livre), `data_evento` | Gestante | **Sensível (saúde)**; texto livre pode ter PII | Registro clínico | [SUPOSIÇÃO] | Gestante (leitura via GET /pregnancyEvents) e médico vinculado; admin; **vão ao Gemini sem sanitização** (agente materno) | AES | [PENDENTE-PO] |
| D12 | Medidas fetais (tabela base) | `medidas_fetais.ccn`, `crl`, `dgn`, `idade_gestacional_semanas` | — | **Não identifica pessoa**: sem chave para gestante/gestação [CONFIRMADO: `\d`, `routes/medicoes.js`] | Cálculo de comprimento fetal | — | Médico/admin (escrita) | AES | — |
| D13 | Biometria fetal (histórico) | `fetal_biometry_history`: `dbp_mm`, `cc_mm`, `ca_mm`, `cf_mm`, pesos, `percentile`, `z_score`, `notes`, `measured_at`, `created_by_user_id` | Gestante/feto | **Sensível (saúde)** | Curvas de crescimento | [SUPOSIÇÃO] | Gestante; médico | **Texto plano**: colunas `numeric`/`date`/`integer` e tabela fora de `ENCRYPTED_FIELDS` [CONFIRMADO] | Sem exclusão exposta pela API; deleted_at existe mas não é usado |
| D14 | Peso materno (histórico) | `maternal_weight_history.weight_kg`, `notes`, `measured_at`, `created_by_user_id` | Gestante | **Sensível (saúde)** | Acompanhamento | [SUPOSIÇÃO] | Gestante; médico | **Texto plano** [CONFIRMADO] | Sem exclusão exposta pela API; deleted_at existe mas não é usado |
| D15 | Documentos e exames | `pregnant_documents`: `document_name`, `document_type`, `file_path`, `extracted_text`, `extraction_*`, `report_comment`, `status`, `reviewed_*`; arquivo em disco | Gestante | **Sensível (saúde)** | Armazenar, extrair e revisar exames | [SUPOSIÇÃO] | Gestante (upload/lista/download dos próprios); médico vinculado/admin | AES nos campos de texto; arquivo `.mfe` AES-GCM; `file_path` em claro; texto extraído cifrado | Excluir documento remove linha e arquivo; sem prazo |
| D16 | Vínculo médico–paciente | `doctor_patient_links.doctor_id`, `pregnant_id`, `status` | Gestante e médico | Pessoal (relação de cuidado) | Controle de acesso | [SUPOSIÇÃO] | API | Em claro (ids) | Sem prazo; **sem consentimento da gestante** |
| D17 | Metadados técnicos | `created_at`, `updated_at`, `version`, `deleted_at`, `encryption_key_version` | Todos | Técnico | Sincronização, versionamento | — | API | — | — |
| D18 | Catálogo LOINC | `loinc_codes` | — | **Sem dado pessoal** | Normalizar termos de exames | — | API | — | — |
| D19 | Trilha de auditoria | `audit_logs`: `actor_id`, `actor_role`, `action`, `resource`, `resource_id`, **`ip_address`** (do `X-Forwarded-For`), **`user_agent`**, `outcome`, `detail` (JSONB: `pregnant_id`, `patient_id`, `fields`, `sanitized_query` do chat) | Usuários | **Pessoal** (IP, acesso a prontuário) | Auditoria | [SUPOSIÇÃO] | Admin (`/api/admin/audit`) | Em claro; regras do banco bloqueiam UPDATE/DELETE | **Sem prazo** |
| D20 | Logs de aplicação | stdout da API (`logger`), com `body` se `LOG_REQUESTS=true` | Todos | Variável | Operação | [SUPOSIÇÃO] | DevOps | Sanitização por regex | [PENDENTE-PO] |
| D21 | Dados enviados ao Gemini | Pergunta (sanitizada por regex, **exceto** no `/agent/maternal-analysis`), trechos de diretrizes, **semanas de gestação**, **eventos (data + descrição livre)** e, só no `/agent/maternal-analysis`, **data de nascimento** [CONFIRMADO: `generationService.buildPatientContext`, `ragController`, `agentController`] | Gestante/médico | **Sensível (saúde)** | Chat clínico | [SUPOSIÇÃO] | Google | Em trânsito (TLS) | [PENDENTE-PO]: política do provedor |
| D22 | Vetores de consulta | Embedding da pergunta enviado ao Pinecone | Usuários | Derivado de texto | Busca semântica | [SUPOSIÇÃO] | Pinecone | — | [PENDENTE-PO] |
| D23 | Arquivos em disco | `uploads/encrypted/*.mfe` (definitivos) e `uploads/` (temporários em claro durante o upload) | Gestante | **Sensível (saúde)** | Armazenar exames | [SUPOSIÇÃO] | Contêiner da API | `.mfe` cifrado; temporário removido após cifrar; o worker de extração lê o arquivo decifrado só em memória [CONFIRMADO]; o OCR trabalha só em memória (PNG em buffer), sem temporários [CONFIRMADO] | **Não é removido ao excluir usuário (R13)** |
| D24 | Sessão no aparelho | Token JWT (8 h por padrão) no app | Todos | Pessoal | Sessão | [SUPOSIÇÃO] | Aparelho | [A VERIFICAR: app mobile] | — |

**Observações do inventário**

- O schema efetivo é `create_tables.sql` + migrations, na ordem do `docker-compose.yml`. `init.sql` está **divergente** (usa `role IN ('user','admin')`, `deleted_at`, `version`) e não é montado no compose; convém removê-lo ou marcá-lo como obsoleto.
- Não há `deleted_at` em `users`, `pregnants`, `pregnancies`, `pregnancy_events` e `pregnant_documents` no banco real: a exclusão é definitiva (cascade).
- Os arquivos definitivos ficam em `uploads/encrypted` dentro de `./apps/api`, montado como bind mount [CONFIRMADO: `docker-compose.yml`]. O `.gitignore` ignora `apps/api/uploads/*` (linha 17) e `.env` (linha 12), e não há arquivo rastreado em `apps/api/uploads` nem `.env` no histórico [CONFIRMADO: `git check-ignore -v`, `git ls-files`, `git log --all`]. A persistência em produção segue [A VERIFICAR] (S15).
- O Postgres publica a porta `5434` no host e a API a `3000`.
- Nenhum caminho de código visto envia o texto extraído dos documentos ao Gemini [CONFIRMADO nos arquivos analisados, incluindo `pdfTextExtractor.js`]. O OCR é local (`pdfjs-dist` e `tesseract.js`, sem `fetch`/`http` no arquivo), renderiza as páginas em buffers de memória (`@napi-rs/canvas`) e não grava arquivos temporários nem registra o texto em log [CONFIRMADO: `pdfTextExtractor.js`]. O arquivo não define `langPath`/`cachePath`: pela configuração padrão da biblioteca, os dados de idioma (`por+eng`) podem ser baixados de um CDN na primeira execução [A VERIFICAR: versão e `defaultOptions` do `tesseract.js`].
- `users.birthdate` permite identificar gestantes menores de 18 anos (S08).

## 3. Mapa de fluxos

### 3.1 Fluxo da gestante

```mermaid
flowchart LR
  G[Gestante / app mobile] -->|cadastro público, login| API[API Express]
  API -->|bcrypt + AES-GCM nos campos| DB[(PostgreSQL)]
  G -->|upload / lista / download dos próprios documentos| API
  G -->|lê histórico fetal e peso| API
  G -->|chat /rag/chat| API
  G -->|token JWT 8 h| AS[(Aparelho)]
```

A gestante **não** atualiza seus dados clínicos depois de criados (`PUT /pregnants/:id` é só médico/admin), mas grava valores clínicos ao criar a gestação (`POST /pregnancies`, R18). Ela também não exclui documentos nem a própria conta (R18).

### 3.2 Fluxo do médico e vínculo

```mermaid
flowchart LR
  R[POST /api/doctors público, sem aprovação] --> M[Médico]
  M -->|GET /search?email=| API[API Express]
  API -->|nome, e-mail, pregnant_id| M
  M -->|POST / com pregnant_id| API
  API -->|INSERT doctor_patient_links ativo| DB[(PostgreSQL)]
  M -->|prontuário, documentos, IA| API
  API -->|checa vínculo ativo| DB
```

O cadastro de médico é público e "por enquanto sem aprovação de admin" [CONFIRMADO: comentário em `routes/doctors.js`], e o vínculo é criado unilateralmente, sem aprovação da gestante (R03).

### 3.3 Fluxo de documentos

```mermaid
flowchart LR
  U[Upload multer 25 MB] --> T[uploads/ temporário em claro]
  T -->|encryptFile AES-GCM| FS[(uploads/encrypted/uuid.mfe)]
  T -->|remove temporário| X[ ]
  API[API] --> DB[(pregnant_documents)]
  W[Worker na própria API, a cada 30 s] -->|lê e decifra só em memória| FS
  W -->|extracted_text cifrado| DB
  D[Médico/admin apaga documento] -->|tombstone, DELETE, rm| FS
  A[Admin apaga usuário] -->|cascade apaga linhas, não os arquivos| DB
```

### 3.4 Fluxo de IA

```mermaid
flowchart TB
  subgraph chat[Chat simples /api/internal/rag/chat]
    Q1[Pergunta] --> S1[sanitizeForLLM: regex CPF, e-mail, telefone, data, CRM]
    S1 --> E1[Embedding local]
    E1 --> P1[(Pinecone: diretrizes públicas)]
    P1 --> G1[Gemini]
    S1 --> G1
  end
  subgraph ag[Agentes /rag/chat/agents e /agent/maternal-analysis]
    Q2[Pergunta + patient_id] --> V[Checa vínculo]
    V --> C[Contexto decifrado do banco]
    Q2 --> K[Regras críticas: sintoma de alarme não chama o LLM]
    C -->|enviado: semanas + eventos data/descrição| G2[Gemini]
    C -->|maternal-analysis: também data de nascimento; pergunta sem sanitização| G2
    Q2 --> E2[Embedding local] --> P2[(Pinecone)]
    P2 --> G2
  end
```

Achados confirmados no código:

- O prompt do agente materno usa só `birthdate`, `latest_pregnancy.weeks` e `all_events` (data e descrição). Campos como HIV, drogas ou antecedentes **não** são enviados ao Gemini hoje; se `buildPatientContext` for ampliado, o risco R01 aumenta.
- `/rag/chat/agents`: remove nome, e-mail, telefone e nascimento do contexto (`removePatientIdentifiers`) e sanitiza a pergunta no grafo; o texto livre dos eventos segue sem tratamento.
- `/agent/maternal-analysis`: **não sanitiza nada**; envia `birthdate`, eventos e a pergunta crua.
- `/rag/search`, `/rag/chat` e `/rag/chat/agents` exigem só autenticação (qualquer papel) e não têm rate limit; `/agent/maternal-analysis` tem rate limit e papel médico/admin, mas **não gera auditoria**.
- `clinicalGraph.js` desvia para "avaliação humana" (sem chamar o LLM) quando a pergunta casa com sintomas de alarme, e pede esclarecimento quando é vaga.
- O erro devolve `error.message` ao cliente nessas rotas (relevante para E7-05.1).

### 3.5 Terceiros e operadores

| Terceiro | Dados enviados | Localização | Contrato/DPA | Status |
| --- | --- | --- | --- | --- |
| Google (Gemini, `gemini-2.5-flash`) | Ver D21 | [SUPOSIÇÃO] fora do Brasil | [PENDENTE-PO] (plano da API, retenção, uso para treinamento) | Confirmado no código |
| Pinecone | Diretrizes públicas (PDFs em `data/guidelines`) e **vetores das perguntas** | [SUPOSIÇÃO] fora do Brasil | [PENDENTE-PO] | Não armazena dados de pacientes [CONFIRMADO: `ragIngestionService.js`] |
| Hugging Face (modelo de embeddings) | Nenhum dado de paciente: baixa o modelo na primeira execução; inferência local | — | — | [A VERIFICAR] cache do modelo |
| CDN dos dados de idioma do Tesseract (`tesseract.js`) | Nenhum dado de paciente: só baixa `por/eng` na primeira execução; OCR local | --- | --- | [A VERIFICAR] versão cache e se pode ser embarcado no contêiner |

## 4. Matriz de risco

Escala: Probabilidade (P) e Impacto (I) de 1 a 3; Nível = P × I (1–2 baixo, 3–4 médio, 6–9 alto). **Valores, prazos e responsáveis são propostas [SUPOSIÇÃO] a validar com o P.O.**

| ID | Ameaça | Dado/fluxo | P | I | Nível | Mitigação (proposta) | Responsável (proposto) | Prazo | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| R01 | Dado pessoal enviado ao Gemini sem sanitização suficiente: `birthdate`, eventos em texto livre e pergunta crua no `/agent/maternal-analysis`; sanitização é só regex e não remove nomes em texto livre | D21, 3.4 | 3 | 2 | 6 | Sanitizar o contexto e a pergunta antes de qualquer chamada ao LLM; enviar faixa etária em vez de `birthdate`; revisar o plano do provedor (S05) | Dev IA/Backend | | Aberto |
| R02 | PII ou dado clínico em logs, doctorController.js passa o e-mail cru ao logger (logger.error(..., { email })); o mascaramento depende só da regex do piiSanitizer [CONFIRMADO]. | D20 | 2 | 3 | 6 | Logger sanitizado existe e passa no `test:ci`; manter `LOG_REQUESTS=false`; E7-06 (lint contra `console.*`) | Dev Backend/Mobile | | Parcial |
| R03 | **Acesso indevido ao prontuário**: cadastro de médico público e sem aprovação [CONFIRMADO]; qualquer `medico` busca gestante por e-mail (recebe nome e e-mail) e cria vínculo com qualquer `pregnant_id`, sem consentimento da gestante; `ensureCanAccessPregnant` responde 404 (não existe) ou 403 (não vinculada), o que permite enumerar IDs. A enumeração é confirmada: clinicalAccess.js responde 404 para ID inexistente e 403 com mensagem própria para não vinculado, para gestação (linhas 103-106) e gestante (67-70, 88-90), e pregnancyEventsController.js:71 responde 404 antes de checar o acesso a eventos [CONFIRMADO]; Além de ler, o médico vinculado edita name e birthdate da gestante (LINKED_DOCTOR_UPDATE_FIELDS) [CONFIRMADO: userPolicy.js] | D16, D04–D15 | 3 | 3 | 9 | Aprovação da gestante para o vínculo; validação de CRM/aprovação de admin no cadastro; limitar e auditar a busca; resposta única para ID inexistente e não vinculado; resposta única 403 também em gestações e eventos | P.O. + Dev Backend | | Aberto |
| R04 | Controle de acesso incompleto: `/rag/*` sem papel e sem rate limit; `medicoes` e `search` de gestantes sem rate limit; erros devolvem `error.message`. `growth` já exige autenticação e tem rate limit [CONFIRMADO], o 409 "Email já cadastrado" em createDoctor permite enumerar contas (mitigado pelo limite de 5 cadastros por 15 min); `GET /health` é público e expõe status, versão e latência do banco e do Pinecone, sem dado pessoal; cada chamada faz `SELECT 1` e `describeIndexStats` no Pinecone, sem rate limit [CONFIRMADO: healthService.js]; nenhuma rota do pacote5 declara rate limit, vale o que server.js monta por prefixo; server.js não define limite global (nenhum "Limiter"); /docs e /health sem autenticação no server.js; o conteúdo de docsRoutes e se expõe o OpenAPI com o schema é [A VERIFICAR]; app.set('trust proxy') não foi pesquisado; pregnancyController.js (linhas 79, 109, 148) e pregnancyEventsController.js (39, 64, 104) devolvem error.message; um :id não numérico faz o Postgres lançar erro de sintaxe, que chega ao cliente como 500 com a mensagem do banco [CONFIRMADO no código; testar]. | API | 2 | 2 | 4 | Papel e rate limit por rota; mensagens de erro genéricas (E7-05.1) | Dev Backend | | Parcial (E7-05.1) |
| R05 | Retenção e descarte indefinidos (dados clínicos, auditoria, logs) | Todos | 3 | 2 | 6 | Política de retenção e rotina de descarte/anonimização | P.O. + Dev Backend | | Aberto |
| R06 | Perda ou vazamento de chaves (JWT, AES, HMAC, senha do banco), mantidas em `.env`. **No ambiente local, `AES_ENCRYPTION_KEY_V1` está vazia no `.env` e no contêiner da API, embora existam registros cifrados**: sem a chave original, esses dados e o documento `.mfe` ficam irrecuperáveis. A API só valida `JWT_SECRET` na inicialização; a chave AES é lida no primeiro uso, então o servidor sobe sem ela e falha depois [CONFIRMADO: `config/security.js`, `cryptoService.js`]. Não há procedimento documentado de guarda e recuperação das chaves [A VERIFICAR]. O `.env` está no `.gitignore` e não consta no histórico do git [CONFIRMADO], então o risco de vazamento pelo GitHub é baixo; permanece o risco de perda e a falta de cofre. | Segredos | 2 | 3 | 6 | Já existem: `JWT_SECRET` com ao menos 32 caracteres, chaves AES validadas quando usadas, scripts de rotação (`jwt:rotate`, `db:rotate-password`, versões AES). Falta: validar chaves AES e HMAC na inicialização, guardar e fazer backup das chaves em cofre de segredos, definir responsável e procedimento de recuperação | Dev Backend/DevOps | | Aberto |
| R07 | Transferência internacional de dados clínicos ao Gemini (LGPD art. 33); o cadastro de médico só valida formato (CRM não vazio e UF com 2 letras), sem unicidade possível (CRM cifrado com IV aleatório) nem verificação, então qualquer pessoa pode se cadastrar com o CRM de outro médico [CONFIRMADO: doctorController.js]. | D21, 3.5 | 2 | 3 | 6 | Definir base e cláusulas; avaliar provedor/região; minimizar o que é enviado (R01) | P.O./Jurídico | | Aberto |
| R08 | Consentimento não coletado nem registrado; não há tabela ou campo de consentimento no schema | D01–D15 | 3 | 3 | 9 | Definir base legal e registrar aceite (versão do termo, data, finalidade) | P.O./Jurídico + Dev | | Aberto |
| R09 | Resposta de IA clínica usada sem revisão humana | 3.4 | 2 | 2 | 4 | Já existem: regras críticas que impedem a chamada ao LLM, prompts proibindo diagnóstico, temperatura 0,2; reforçar o aviso na UI | P.O./Clínico | | Parcial |
| R10 | Exposição de documentos: sem lista de tipos permitidos nem antivírus; temporário em claro durante o upload; upload/download sem rate limit; pasta de armazenamento dentro do diretório da API (ignorada pelo git; o risco restante é a persistência em produção), o OCR e o pdfjs processam PDF não confiável no processo da API sem limite de páginas, tempo ou escala (loop até numPages, scale 2 por padrão), e o pdfjs é aberto sem isEvalSupported:false [CONFIRMADO: pdfTextExtractor.js]; package.json pede pdfjs-dist ^4.10.38, acima da correção do CVE-2024-4367 (4.2.67) [CONFIRMADO]; conferir a versão resolvida no lockfile; ainda assim passar isEvalSupported:false é boa prática. `document_type` é controlado pelo cliente (documentsController.js:131) e é usado como Content-Type no download (linha 258) e é editável (linha 14): sem lista de tipos, é possível servir conteúdo ativo (ex. text/html) pela origem da API [CONFIRMADO no uso; cabeçalhos Content-Disposition/nosniff [A VERIFICAR]] | D15, D23 | 2 | 3 | 6 | Validar tipo/assinatura; volume dedicado em produção; rate limit, limitar páginas, dimensões e tempo do OCR; isEvalSupported:false; conferir a versão do pdfjs-dist no lockfile; embarcar os dados de idioma do Tesseract, lista fixa de tipos aceitos; derivar o tipo do conteúdo (assinatura do arquivo), não do cliente; no download usar Content-Disposition: attachment e X-Content-Type-Options: nosniff. | Dev Backend | | Parcial |
| R11 | Registros legados em texto plano: `decrypt` aceita texto sem prefixo `vN:` sem alertar; migração só oportunística (no login ou na busca por e-mail). No banco local, `users` (2 de 2), `doctors` (1 de 1) e `pregnant_documents` (1 de 1) estão no formato de envelope AES; a única linha de `pregnants` está com as colunas classificadas vazias [CONFIRMADO: consulta SQL], logo não há texto plano legado nem dado cifrado nessa tabela; o `aes:migrate:dry-run` varreu 5 registros mas não concluiu (R06). Resultado: nenhum registro legado em texto plano no banco local. Como `pregnants` não tem dados, a cifragem dessa tabela só está evidenciada por teste (`test:clinical-crypto`), não por dado real; as atualizações parciais (updatePregnancy, updatePregnancyEvent, sync) sobrescrevem encryption_key_version da linha com a versão atual mesmo recifrando só parte das colunas; o envelope vN preserva a leitura, mas o metadado deixa de refletir as colunas antigas e pode enganar o aes:migrate [CONFIRMADO no código; critério do migrate [A VERIFICAR]]. | D01–D15 | 1 | 3 | 3 | Rodar `aes:migrate:dry-run` em cada ambiente com dados reais antes de usá-lo; alertar ao ler texto plano | Dev Backend | | Parcial (sem legado no banco local); pregnants (sem dados; outros ambientes não medidos) |
| R12 | **Históricos fetal e de peso materno em texto plano** no banco (colunas numéricas e tabelas fora de `ENCRYPTED_FIELDS`); notes é texto livre de até 2000 caracteres gravado em texto plano, sem sanitização [CONFIRMADO: clinicalHistoryService.js:42-54]; SELECT * devolve também created_by_user_id e deleted_at ao cliente. | D13, D14 | 3 | 2 | 6 | Cifrar (mudar tipos e classificação) ou aceitar o risco com justificativa do P.O. | P.O./Dev | | Aberto (confirmado) |
| R13 | **Exclusão de usuário** (`DELETE /users/:id`, admin) apaga linhas por cascade, mas nenhum código remove os arquivos `.mfe`, e a ação não é auditada; a coluna deleted_at dos históricos não é preenchida por nenhum código analisado (sem endpoint de exclusão) | D13–D15, D23 | 3 | 2 | 6 | Excluir arquivos ao apagar usuário/gestante; auditar; purgar `deleted_at` antigos | Dev Backend | | Aberto (confirmado) |
| R14 | Gestantes menores de 18 anos (LGPD art. 14) | D01 | 2 | 3 | 6 | Decidir se o público inclui adolescentes e como obter consentimento do responsável | P.O./Jurídico | | Aberto |
| R15 | Texto livre em `detail` da auditoria (`sanitized_query` do chat) e em logs, com sanitização só por regex; o cadastro grava o e-mail normalizado no detail da auditoria (userController.js:173), mascarado só se o sanitizador o cobrir [A VERIFICAR] | D19, D20 | 2 | 2 | 4 | Registrar só metadados (tamanho, rota); não guardar o texto da pergunta | Dev Backend | | Aberto |
| R16 | Backups e infraestrutura: o compose só define o volume `db_data`, sem rotina de backup; porta 5434 publicada no host; HTTPS só é exigido com `NODE_ENV=production` ou `ENFORCE_HTTPS=true`; `test:transport-security` passou (valida HTTPS obrigatório e rate limiting); TLS entre API e banco não verificado | D20, 3.x | 2 | 3 | 6 | Backup cifrado e com acesso restrito; não publicar a porta do banco em produção | DevOps | | Aberto |
| R17 | **Auditoria incompleta ou com falha silenciosa**: registro assíncrono que só loga erro; `audit_logs` não existia no banco local até `db:migrate`; `doctorPatientLinkController` chama `audit()` sem importá-lo [A VERIFICAR]; sem auditoria em `maternal-analysis`, busca de gestante, remoção de vínculo, `DELETE /users`, `GET /users` (admin), `GET /pregnants/:id` e leituras de documento; o IP vem do `X-Forwarded-For` sem validar proxy confiável (falsificável), sem auditoria em createDoctor, em todo o clinicalHistoryController (leitura e criação de D13/D14) e no requireUserAccess (acessos de admin e do médico vinculado a /users/:id) [CONFIRMADO: ausência de audit( nesses arquivos], sem audit() em pregnancyController, pregnancyEventsController, syncController e auditController, nem na leitura em massa do admin [CONFIRMADO: ausência de audit( nesses arquivos]. | D19 | 3 | 2 | 6 | Importar `audit`; auditar leituras clínicas, ações de admin e o agente; alerta de falha de auditoria; usar `req.ip` com `trust proxy` configurado | Dev Backend | | Aberto |
| R18 | Titular sem canal para exercer direitos (art. 18): a gestante não pode apagar documento nem a própria conta (`DELETE /users` é só admin), não corrige dados clínicos (`PUT /pregnants`, `PUT /pregnancies/:id` e `PUT /pregnancyEvents/:id` só médico/admin) e não há exportação [CONFIRMADO nas rotas analisadas]. A gestante cria gestação (`POST /pregnancies`) e nesse ato grava `ccn`, `dgm`, `glicemia`, `frequencia_cardiaca`, `altura_uterina` e `is_checked`, sem validação de tipo ou faixa [CONFIRMADO: pregnancyController.js:11-50]; é problema de exatidão dos dados (LGPD art. 6º, V), e o significado de `is_checked` é [A VERIFICAR]. Os históricos fetal e de peso não têm exclusão exposta pela API [CONFIRMADO: clinicalHistoryController/Service]. | P.O. + Dev | | Aberto |
| R19 | Sessão: JWT de 8 h por padrão (`JWT_EXPIRES_IN`) com `role` no token; o login confere `is_active`, mas o middleware não; `jwt.verify` sem `algorithms`; sem revogação ou logout, requireUserAccess e as rotas de gestações, eventos, histórico e auditoria confiam em req.user.role/id do token e não consultam is_active nem o papel no banco; desativar uma conta ou rebaixar um admin só vale após o token expirar [CONFIRMADO: userAccess.js, routes/*.js]; clinicalAccess.js também não confere is_active [CONFIRMADO]. | API | 2 | 3 | 6 | Fixar algoritmo; conferir `is_active`/papel nas rotas clínicas; reduzir o tempo de vida ou criar revogação | Dev Backend | | Aberto |
| R20 | **Privilégio de admin amplo e sem trilha de leitura**: admin lista todos os usuários decifrados e acessa qualquer gestante, sem auditoria de leitura; o cadastro público fixa o papel `gestante` (`userPolicy.js`; `userController.js:158` grava a constante no INSERT, então o `role` do body é ignorado) [CONFIRMADO]; só um admin altera `role`, `email`, `password` e `is_active` de qualquer conta, inclusive de outros admins, sem aviso ao titular e sem auditoria de leitura no `requireUserAccess` [CONFIRMADO: userPolicy.js, userAccess.js]; nenhum seed de admin em .sql/.sh/.md; scripts .js não pesquisados [A VERIFICAR]; alterações feitas via PUT /users/:id são auditadas (userController.js:276); se o detail registra role e campos alterados é [A VERIFICAR]; `POST /api/sync` (só admin) devolve decifradas as linhas de todas as tabelas de `SYNC_TABLES` desde `last_sync_timestamp` (tabela inteira se omitido) e grava nelas, sem vínculo e sem `audit()` [CONFIRMADO: syncController.js]; quais tabelas e colunas entram é [A VERIFICAR: syncPolicy.js]. `GET /pregnancies` do admin devolve todas as gestações decifradas, sem paginação nem auditoria (pregnancyController.js:86-87); a leitura de `/api/admin/audit` também não é auditada [CONFIRMADO]. | D01–D15 | 2 | 3 | 6 | Princípio do menor privilégio; auditar leituras de admin; definir quem pode ser admin, exigir confirmação por e-mail ou segundo admin para alterar role/password de admin; auditar as ações de admin; auditar sync e leituras de admin; limitar tabelas/colunas do sync (sem users.password); desativar o sync em produção se o app não o usar. | P.O. + Dev Backend | | Aberto |

## 5. Controles existentes e lacunas

| Controle | Evidência | Riscos | Lacuna / observação |
| --- | --- | --- | --- |
| Criptografia AES-256-GCM de campos | `cryptoService.js` (IV aleatório, AAD `tabela:campo`, chaves por versão); `ENCRYPTED_FIELDS` (110 colunas, mesmo número do `.env.example`); colunas `TEXT`; registros locais de `users`, `doctors` e `pregnant_documents` no formato AES; `pregnants` sem dados preenchidos (cifragem evidenciada só pelos testes); `test:ci`, `test:crypto` e `test:clinical-crypto` passaram | R06, R11 | `decrypt` aceita texto sem prefixo; AAD não inclui o id do registro; tabelas fora da classificação (R12) |
| Versionamento e rotação de chave | `encryption_key_version`, `file_encryption_version`, `AES_ENCRYPTION_KEY_V<n>`, `aes:init`, `aes:migrate` | R06, R11 | `aes:migrate:dry-run` ainda não concluiu (chave AES não encontrada no ambiente do script) |
| Hash de senha | bcrypt com 10 rounds; senha mínima de 8 caracteres | R19 | — |
| Busca por e-mail sem expor o dado | `users.email_lookup_hash` (HMAC, índice único) | R01 | Fallback para legados faz varredura e decifra os usuários sem hash |
| Criptografia de arquivos | `fileCryptoService.js` (cabeçalho `MFENC001`, AAD com `pregnantId`, gravação atômica, modo 0600); `test:ci` passou | R10 | Aceita arquivo legado em claro por padrão; temporário em claro no upload |
| Autorização por papel e vínculo | `requireRole`; `clinicalAccess.js`; `documentsController`; `pregnantController` (médico só lista os vinculados); `agentController` (mesma resposta para ID inexistente e sem vínculo); `crossPatientAuthorization` passou | R03, R04 | Vale só se o vínculo for legítimo (R03); 404 × 403 permite enumerar IDs de gestante, gestação e evento (R03) [CONFIRMADO], requireUserAccess devolve 403 igual para usuário inexistente e não vinculado (sem enumeração por ele); não confere is_active (R19). |
| Rate limit | `authRateLimit.js`: login 10, registro 5, admin 100, clínico 60 por 15 min; `growth` e `/agent/maternal-analysis` | R04 | Ausente em documentos, vínculos, `medicoes` e `/rag/*` `/health`, `/api/sync` |
| Sanitização de PII | `piiSanitizer.js` (CPF, e-mail, telefone, data, CRM; nomes por chave); `logger.js`; `piiSanitizer` e `logger` passaram no `test:ci` | R01, R02, R15 | Não remove nomes em texto livre; não usada no `/agent/maternal-analysis` |
| Auditoria | `auditService.js` + `audit_logs` (regras contra UPDATE/DELETE); eventos de usuário, gestante, documento, vínculo, chat RAG e bloqueios; `detail` sanitizado | R17 | Ver R17 |
| Exclusão de documento | `deleteDocument`: tombstone, DELETE em transação, remoção do arquivo e auditoria | R13 | Não cobre a exclusão de usuário |
| Limite de upload | `DOCUMENT_MAX_UPLOAD_BYTES` (25 MB) | R10 | Sem lista de tipos; `document_type` vem do cliente (R10) |
| Transporte | `requireHttps` (HTTPS obrigatório com `NODE_ENV=production`/`ENFORCE_HTTPS`; HSTS); CORS com lista de origens (padrão `localhost`) | R16 | `test:transport-security` passou |
| Segredos | `JWT_SECRET` ≥ 32 caracteres (validado na inicialização); `jwt:rotate`, `db:rotate-password`, `aes:key`, `aes:init` | R06 | Chaves em `.env`; chave AES vazia no ambiente local; sem validação das chaves AES/HMAC na inicialização; sem backup de chaves documentado. `.env` ignorado pelo git (`.gitignore:12`) |
| Mitigação de IA | `clinicalGraph.js` (regras críticas sem LLM, pedido de esclarecimento), prompts, temperatura 0,2 | R09 | — |
| Login | Mensagem genérica de erro; confere `is_active`; falhas auditadas | R19 | Sem bloqueio por conta |

## 6. Proposta de responsáveis

| Área / risco | Responsável proposto (papel) | Nome | Confirmado pelo P.O.? |
| --- | --- | --- | --- |
| Backend/API, criptografia, retenção técnica | Dev backend | | Não |
| Mobile (sessão, logs) | Dev mobile | | Não |
| IA/RAG e terceiros | Dev IA/backend | | Não |
| Banco de dados, backups, infraestrutura | Dev backend/DevOps | | Não |
| Base legal, consentimento, transferência internacional, vínculo | P.O. + jurídico | | Não |
| Encarregado/DPO | A definir | | Não |

## 7. Regras de retenção e descarte (proposta)

| Dado | Prazo proposto | Forma de descarte | Status |
| --- | --- | --- | --- |
| Conta e dados cadastrais (D01–D03) | [SUPOSIÇÃO] enquanto a conta existir | Exclusão da conta (cascade) **e** dos arquivos; limpeza de backups | [PENDENTE-PO] |
| Dados clínicos (D04–D14) | [SUPOSIÇÃO] | Exclusão/anonimização; purga de `deleted_at` | [PENDENTE-PO] |
| Documentos e texto extraído (D15, D23) | [SUPOSIÇÃO] | Apagar arquivo e linha (já ocorre ao apagar o documento) | [PENDENTE-PO] |
| Auditoria e logs (D19, D20) | [SUPOSIÇÃO] | Rotação; anonimizar IP após prazo | [PENDENTE-PO] |

## 8. Suposições e decisões pendentes

| ID | Suposição / decisão | Impacto | Quem decide | Status |
| --- | --- | --- | --- | --- |
| S01 | Base legal de cada tratamento (tutela da saúde, consentimento, execução de contrato) | R08 | P.O./jurídico | Pendente |
| S02 | Prazos de retenção e descarte | R05, R13 | P.O. | Pendente |
| S03 | Existência e nome do DPO/encarregado | Governança | P.O. | Pendente |
| S04 | Modelo e registro de consentimento da gestante | R08 | P.O./jurídico | Pendente |
| S05 | Localização, plano e contrato com Google (Gemini) e Pinecone | R07 | P.O./jurídico | Pendente |
| S06 | Uso de IA em contexto clínico real e responsabilidade pela revisão | R09 | P.O./clínico | Pendente |
| S07 | Histórico fetal e peso materno devem ser criptografados? | R12 | P.O./Dev | Pendente |
| S08 | O público inclui gestantes menores de 18 anos? | R14 | P.O./jurídico | Pendente |
| S09 | `medidas_fetais` guarda dados de pacientes? | D12 | Dev | **Resolvido**: não identifica paciente (sem chave de vínculo) |
| S10 | Registros legados: haverá migração forçada para AES? | R11 | Dev/P.O. | Pendente |
| S11 | O vínculo médico–paciente exige aprovação da gestante? | R03 | P.O./jurídico | Pendente |
| S12 | Como validar o CRM e aprovar o cadastro de médicos? | R03 | P.O./Dev | Pendente (confirmado: hoje o cadastro é público e valida só o formato do CRM) |
| S13 | O agente materno pode receber data de nascimento e texto livre dos eventos? | R01 | P.O./clínico | Pendente |
| S14 | Como a gestante exerce acesso, correção, portabilidade e eliminação dos dados? | R18 | P.O./jurídico | Pendente |
| S15 | Onde ficam os arquivos e os backups em produção? | R10, R16 | DevOps | Pendente |
| S16 | Política de acesso do admin (quem, escopo e auditoria de leitura). Parcial: admin altera role/e-mail/senha de qualquer conta (userPolicy); falta origem do primeiro admin e auditoria; inclui o POST /api/sync e o GET /pregnancies do admin | R20 | P.O. | Pendente |
| S17 | Prazo e minimização de IP e user agent na auditoria | R05, R17 | P.O./jurídico | Pendente |
| S18 | Onde as chaves AES, HMAC e JWT ficam guardadas, quem tem acesso e como são recuperadas ou rotacionadas | R06 | P.O./DevOps | Pendente |
| S19 | O POST /api/sync será usado em produção, com quais tabelas e colunas, e com auditoria? | R20, R17 | P.O./DEV | Pendente |
| S20 | A gestante pode informar valores clínicos ao criar a gestação? O que significa is_checked? | R18 | P.O./clínico | Pendente |

## 9. Revisão do P.O.

- [ ] Riscos aceitos
- [ ] Responsáveis e prazos
- [ ] Evidências de mitigação
- [ ] Pendências jurídicas/clínicas
- [ ] Regras de retenção/descarte

**Aceite:** ______________________ Data: ____/____/______

---
