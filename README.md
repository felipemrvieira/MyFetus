# MyFetus 3.0

Documentação técnica de transição do projeto MyFetus 3.0 (versão `v3.0.0-rc` / ciclo 2026.2).

O **MyFetus 3.0** é um sistema acadêmico de saúde digital voltado ao acompanhamento materno-fetal durante o pré-natal. A solução conecta gestantes e profissionais de saúde em uma plataforma integrada, composta por aplicativo mobile, API REST, banco de dados PostgreSQL, processamento automatizado de exames, motor determinístico de risco obstétrico, prontuário clínico estruturado, diário gestacional versionado, consultas com adendos auditáveis, emissão de relatórios protegidos em PDF, exportação interoperável FHIR e recursos de apoio à decisão clínica com IA (RAG com citações rastreáveis e guardrails).

Este README foi escrito para permitir que uma nova equipe consiga entender, configurar, executar, testar e continuar o desenvolvimento do projeto sem depender de conhecimento prévio da equipe anterior.

## Sumário

- [Estado do projeto](#estado-do-projeto)
- [Repositórios](#repositórios)
- [Visão geral da solução](#visão-geral-da-solução)
- [Funcionalidades implementadas](#funcionalidades-implementadas)
- [Arquitetura](#arquitetura)
- [Tecnologias utilizadas](#tecnologias-utilizadas)
- [Estrutura do monorepo](#estrutura-do-monorepo)
- [Configuração e execução local](#configuração-e-execução-local)
- [Variáveis de ambiente](#variáveis-de-ambiente)
- [Banco de dados](#banco-de-dados)
- [API](#api)
- [Processamento de documentos](#processamento-de-documentos)
- [RAG e chat clínico](#rag-e-chat-clínico)
- [Segurança e privacidade](#segurança-e-privacidade)
- [Testes](#testes)
- [CI/CD e deploy](#cicd-e-deploy)
- [Scripts úteis](#scripts-úteis)
- [Credenciais de teste](#credenciais-de-teste)
- [Bugs conhecidos](#bugs-conhecidos)
- [Limitações e backlog futuro](#limitações-e-backlog-futuro)
- [Troubleshooting](#troubleshooting)
- [Documentação técnica v3](#documentação-técnica-v3)
- [Documentação complementar](#documentação-complementar)
- [Licença e uso](#licença-e-uso)

## Estado do projeto

| Item | Situação |
|---|---|
| Tipo de projeto | Monorepo acadêmico em fase de transição (Release Candidate v3.0.0 / ciclo 2026.2) |
| Aplicação mobile | Implementada em Expo/React Native (diário versionado, métricas, séries temporais, gráficos e E2E Maestro) |
| Backend | Implementado em Node.js/Express 5.x com arquitetura em camadas e documentação OpenAPI 3.1 |
| Banco de dados | PostgreSQL 15 via Docker Compose com migrações transacionais e controle em `schema_migrations` |
| Autenticação e autorização | JWT com controle de papéis (`gestante`, `medico`, `admin`) e autorização contextual por vínculo médico-paciente |
| Perfis suportados | Gestante, médico e administrador |
| Processamento de documentos | Upload cifrado (AES-GCM), extração com PDF.js e OCR (Tesseract.js), parser laboratorial e revisão médica versionada |
| Motor de risco e alertas | Regras obstétricas MS 2022/FEBRASGO validadas por estudo cego, histórico de encerramento e dashboard ordenado por gravidade |
| Diário da gestante | Registro diário versionado com alarmes clínicos automáticos, cálculo por idade gestacional e métricas no histórico |
| Consultas e relatórios | Registro de consultas com cadeia de adendos auditáveis, devolutivas versionadas e relatórios de gestação em PDF protegido |
| RAG e chat clínico | Busca semântica, Pinecone, Gemini, citações obrigatórias de fontes oficiais, guardrails e suíte de avaliação reproduzível (`rag:eval`) |
| Interoperabilidade e LGPD | Exportação experimental em bundle FHIR e endpoints de direitos do titular (exportação estruturada e exclusão de conta) |
| Deploy de homologação | Cloud Run GCP com HTTPS, segredos gerenciados e CD automatizado via GitHub Actions (OIDC) |
| Deploy de produção | Não implementado (ambiente de homologação opera exclusivamente com dados sintéticos; produção no backlog 2027.1) |
| CI/CD | Pipeline automatizado com lint, typecheck, testes unitários/integração, CodeQL, build Docker e smoke tests HTTPS |
| Bugs conhecidos | Nenhum bug bloqueante (P1) aberto no commit de freeze; processo de triagem P1/P2/P3 formalizado |

## Repositórios

| Tipo | Link | Branch principal | Observação |
|---|---|---|---|
| Versão atual | <https://github.com/felipemrvieira/MyFetus.git> | `main` | Repositório oficial para continuidade do desenvolvimento e transição para o ciclo 2027.1. |
| Versão herdada | <https://github.com/Lucasrc22/github-grupo7.git> | `main` | Base histórica legada utilizada antes da evolução do sistema. |

## Visão geral da solução

O MyFetus 3.0 conecta gestantes e profissionais obstetras em torno de duas jornadas clínicas essenciais:

1. **Jornada da gestante**:
   - Acompanhamento cronológico do desenvolvimento gestacional semana a semana.
   - Diário gestacional versionado para reporte de sintomas, humor, temperatura, hidratação e contrações, com avaliação algorítmica de sinais de alarme.
   - Envio e visualização do status de processamento de exames laboratoriais e ultrassons.
   - Visualização das devolutivas médicas publicadas e histórico clínico.
   - Emissão e compartilhamento nativo de relatório obstétrico consolidado em PDF.
   - Chat clínico seguro com IA, trazendo respostas restritas a fontes normativas do Ministério da Saúde e FEBRASGO, com citações explícitas e avisos de limitação.
   - Painel de privacidade LGPD para consentimentos, exportação de dados e exclusão de conta.

2. **Jornada médica**:
   - Dashboard clínico de pacientes priorizado dinamicamente por gravidade dos alertas (triagem obstétrica: verde, amarelo e vermelho).
   - Prontuário obstétrico integral com identificação, antecedentes familiares, antecedentes clínicos, gestações anteriores, gestação atual e histórico vacinal.
   - Gestão de alertas clínicos: recebimento, reconhecimento com justificativa e encerramento com registro histórico append-only.
   - Módulo laboratorial: solicitação de exames, parsing automático e revisão médica dos analitos extraídos (aceitar, corrigir, rejeitar, reabrir).
   - Visualização gráfica de séries temporais de analitos específicos ao longo das semanas de gestação (sem interpolação falsa).
   - Curvas de crescimento fetal (biometria de Hadlock) e ganho ponderal materno (Atalah).
   - Registro estruturado de consultas pré-natais com suporte a adendos cronológicos auditáveis.
   - Emissão de devolutivas médicas versionadas vinculadas aos documentos analisados.
   - Geração e autorização de snapshots de relatório de gestação com download de PDF protegido.

3. **Camada backend e infraestrutura**:
   - Autenticação JWT e autorização rígida impedindo acesso indevido entre prontuários (prevenção a IDOR).
   - Criptografia em repouso AES-256-GCM para dados clínicos e documentos, com versionamento de chaves e busca indexável de e-mail por HMAC-SHA256.
   - Motor determinístico de risco obstétrico calibrado por estudo de validação cega com especialistas.
   - Trilha de auditoria append-only para todas as operações críticas e administrativas.
   - Interoperabilidade via exportação experimental de FHIR Pregnancy Bundle.
   - Pipeline de CI/CD automatizado com verificação estrita de contratos OpenAPI e testes de segurança.

## Funcionalidades implementadas

### Gestante

- Cadastro e login com fluxo de termos de consentimento versionados e auditáveis.
- Navegação fluida por abas no aplicativo móvel.
- Acompanhamento semanal do desenvolvimento fetal com cálculo de idade gestacional e DPP.
- Diário gestacional versionado: registro de humor, hidratação, contrações, temperatura e sintomas clínicos, validado pela idade gestacional e com disparo de alertas de emergência.
- Histórico de métricas diárias exibido cronologicamente.
- Checklist interativo de cuidados pré-natais e metas diárias de hidratação.
- Módulo de exames: upload de arquivos PDF/imagem, acompanhamento do processamento e leitura das devolutivas emitidas pelo médico.
- Download e compartilhamento nativo do relatório de gestação em PDF através da folha de compartilhamento do sistema operacional.
- Chat clínico integrado com RAG, contendo citações de fontes bibliográficas e avisos de contingência clínica.
- Central de privacidade LGPD: consulta às finalidades dos dados, revogação de consentimentos, exportação completa dos dados em formato estruturado e exclusão irreversível da conta mediante confirmação de senha.

### Médico

- Cadastro médico com CRM, UF e especialidade, sujeito ao fluxo de aprovação administrativa.
- Dashboard clínico inteligente com ordenação automática de gestantes por gravidade de risco (vermelho > amarelo > verde).
- Gestão de vínculos médico-gestante com pesquisa e ativação/desativação controlada.
- Prontuário eletrônico completo: identificação, dados antropométricos, antecedentes clínicos/familiares, histórico obstétrico, intercorrências, vacinas e ultrassons.
- Painel de alertas de risco: visualização detalhada dos gatilhos clínicos, reconhecimento formal de alertas e encerramento com justificativa médica e histórico completo.
- Módulo de exames e analitos: emissão de pedidos de exame, visualização do texto extraído (PDF.js/OCR) e revisão médica versionada de cada analito (aceite, correção de valor/unidade, rejeição e reabertura com justificativa).
- Gráficos de série temporal de analito individual (ex.: hemoglobina, glicemia) correlacionado com as semanas gestacionais.
- Gráficos biométricos fetais (Hadlock: DBP, CC, CA, Fêmur, Peso Estimado) e curva de ganho de peso materno (Atalah).
- Registro de consultas obstétricas com histórico auditável e encadeamento de adendos (`parent_consultation_id`).
- Elaboração e publicação de devolutivas médicas versionadas vinculadas aos documentos avaliados.
- Geração de snapshots e emissão de relatório completo de gestação em PDF criptograficamente protegido.

### Backend

- API REST construída sobre Express 5.x com validação rigorosa de esquemas (`express-validator`).
- Autenticação JWT com suporte a segredo versionado e rotação segura sem interrupção de serviço.
- Autorização em camadas: autenticação de token, checagem de papel (`gestante`, `medico`, `admin`) e verificação estrita de vínculo clínico (`ensureCanAccessPregnant`).
- Hardening HTTP completo: Helmet, HSTS, CORS parametrizado e múltiplos rate limits dedicados (autenticação, cadastro, consultas clínicas, documentação, exportação e exclusão LGPD).
- Motor determinístico de risco (`riskEngine.js`) avaliando 12 categorias clínicas com base em diretrizes oficiais e dados de exames/diário.
- Worker de documentos assíncrono para processamento em segundo plano com PDF.js e OCR com Tesseract.js.
- Parser seguro de resultados laboratoriais com normalização semântica para o catálogo LOINC.
- Gestão de tokens de push notification móveis com armazenamento cifrado e controle de revogação.
- Exportação experimental em padrão FHIR (Fast Healthcare Interoperability Resources) gerando bundles de gestação.
- Endpoints de direitos do titular LGPD para portabilidade de dados em JSON e exclusão de conta em conformidade com a legislação.
- Trilha de auditoria append-only (`audit_logs`) com triggers impedindo edição ou deleção física de registros.
- Sistema de migrações transacionais com advisory lock e tabela `schema_migrations` garantindo idempotência e integridade do banco.

### Inteligência artificial e apoio clínico

- Base de conhecimento clínico estruturada com manifesto de fontes aprovadas pelo Product Owner.
- Pipeline de ingestão com extração de texto, chunking determinístico e embeddings locais (`Xenova/multilingual-e5-small`).
- Banco vetorial Pinecone para busca semântica por similaridade de alta performance.
- Chat clínico conversacional com LLM Google Gemini (`gemini-2.5-flash`), exigindo citações diretas das diretrizes normativas anexadas ao contexto.
- Guardrails de segurança em camadas: sanitização de PII em logs e prompts, confinamento ao escopo de saúde materno-fetal, detecção de urgências obstétricas com orientação de atendimento presencial e neutralização de tentativas de prompt injection.
- Suíte de avaliação reproduzível do RAG (`npm run rag:eval`), executando 50 casos clínicos de teste gabaritados e validando métricas de recuperação e citação.
- Simulador de estresse do RAG para validação de resiliência sob condições de sobrecarga, respostas truncadas e contexto extenso.

## Arquitetura

```text
                     Aplicativo Mobile Expo / React Native
                       Gestante | Médico (Android / iOS)
                                     |
                                     | HTTPS / JSON (JWT)
                                     v
                           API Node.js / Express 5
                                     |
       -------------------------------------------------------------
       |              |              |              |              |
   PostgreSQL 15    Worker       Motor de Risco   RAG / IA      Auditoria
  (AES-256-GCM /   PDF/OCR       e Alertas     (Pinecone /   (Append-only /
 schema_migrations) (Tesseract)   (MS 2022)      Gemini)        LGPD)
       |                                            |
       v                                            v
  Exports FHIR                              Citações & Fontes
```

### Responsabilidades por camada

| Camada | Responsabilidade | Localização |
|---|---|---|
| `apps/mobile` | Interface móvel, navegação Expo Router, diário gestacional, dashboard médico por gravidade, gráficos Victory Native e compartilhamento de PDFs. | `apps/mobile` |
| `apps/api` | Endpoints REST, autenticação, autorização contextual, motor de risco, workers de extração, RAG, exportação FHIR e conformidade LGPD. | `apps/api` |
| `apps/api/db` | Schema relacional, triggers de auditoria, migrações versionadas via `schema_migrations` e dados de seed. | `apps/api/db` |
| `e2e` | Suíte de testes ponta a ponta para a aplicação mobile utilizando o framework Maestro. | `e2e` |
| `scripts` | Geradores de datasets sintéticos (PDFs nativos e OCR escaneado), scripts de validação cega de risco, executor de eval do RAG e testes de estresse. | `scripts` |
| `tests` | Testes integrados de extração de PDFs e fixtures sintéticas do repositório. | `tests` |

## Tecnologias utilizadas

### Frontend mobile

| Tecnologia | Versão | Finalidade |
|---|---:|---|
| Expo | 56.x | Plataforma de desenvolvimento e build do aplicativo mobile. |
| React Native | 0.85.x | Framework para desenvolvimento da interface móvel multiplataforma. |
| React | 19.x | Biblioteca para construção de componentes declarativos. |
| TypeScript | 6.x | Tipagem estática e segurança em tempo de compilação. |
| Expo Router | 56.x | Navegação por rotas baseadas no sistema de arquivos. |
| Async Storage | 2.x | Armazenamento local seguro de tokens de sessão. |
| Victory Native | 36.x | Renderização dos gráficos de crescimento fetal e séries temporais de analitos. |
| Maestro | Latest | Automação e execução dos testes E2E mobile no emulador. |

### Backend

| Tecnologia | Versão | Finalidade |
|---|---:|---|
| Node.js | 18+ (LTS) | Ambiente de execução do servidor backend. |
| Express | 5.1.x | Framework web HTTP para a API REST. |
| PostgreSQL | 15-alpine | Banco de dados relacional principal. |
| JWT (`jsonwebtoken`) | 9.x | Autenticação stateless baseada em tokens assinados. |
| bcrypt | 6.x | Criptografia hash de senhas de usuários. |
| multer | 2.x | Gerenciamento de uploads de arquivos multipart/form-data. |
| express-rate-limit | 8.x | Proteção contra ataques de força bruta e negação de serviço. |
| helmet | 8.x | Hardening de cabeçalhos de segurança HTTP. |
| express-validator | 7.x | Validação e sanitização estrita de payloads HTTP de entrada. |
| swagger-ui-express | 5.x | Interface visual do Swagger para exploração do contrato OpenAPI. |
| pdf-lib | 1.17.x | Geração e manipulação programática de relatórios médicos em formato PDF. |
| dotenv | 16.x | Carregamento de variáveis de ambiente a partir do arquivo `.env`. |

### Documentos, IA e dados clínicos

| Tecnologia | Finalidade |
|---|---|
| PDF.js (`pdfjs-dist`) | Extração determinística de texto em PDFs laboratoriais nativos. |
| Tesseract.js | OCR para extração de caracteres em exames escaneados ou fotografados. |
| `@napi-rs/canvas` | Renderização nativa de páginas PDF para processamento óptico via OCR. |
| Pinecone (`@pinecone-database/pinecone`) | Banco de dados vetorial em nuvem para recuperação semântica no RAG. |
| Hugging Face Transformers | Geração local de embeddings semânticos (`Xenova/multilingual-e5-small`). |
| Google Gemini (`@google/genai`) | Modelo de linguagem (`gemini-2.5-flash`) para raciocínio clínico com citação de fontes. |
| LOINC | Padronização universal e normalização de termos e analitos laboratoriais. |
| FHIR (HL7) | Padrão aberto de interoperabilidade em saúde utilizado na exportação de prontuários. |

### Infraestrutura e testes

| Tecnologia | Finalidade |
|---|---|
| Docker & Docker Compose | Containerização do banco PostgreSQL e execução consistente da API. |
| Node.js Test Runner / Jest | Execução das suítes de testes unitários, integrados e de segurança. |
| GitHub Actions | Orquestração do pipeline de CI (testes, CodeQL, lint) e CD (deploy em homologação). |
| Google Cloud Run | Hospedagem em contêiner gerenciado do ambiente de homologação HTTPS. |
| Google Secret Manager | Armazenamento seguro de segredos de infraestrutura em nuvem. |
| OIDC (Workload Identity) | Autenticação segura entre o GitHub Actions e o Google Cloud sem chaves estáticas. |

## Estrutura do monorepo

```text
MyFetus/
├── .github/                        # Workflows do GitHub Actions (CI, CD, CodeQL, Dependabot)
├── apps/
│   ├── api/                        # Backend REST (Express 5)
│   │   ├── config/                 # Configurações de segurança, rate limit e allowlist OpenAPI
│   │   ├── controllers/            # Controladores HTTP com autorização contextual
│   │   ├── data/                   # Regras de risco em JSON e catálogo LOINC
│   │   ├── db/                     # Scripts SQL, triggers e migrações versionadas
│   │   ├── middlewares/            # Autenticação JWT, autorização de papéis e sanitização
│   │   ├── routes/                 # Definição e roteamento dos endpoints da API
│   │   ├── scripts/                # Scripts de segredos, migrações, rotação e RAG
│   │   ├── services/               # Serviços de domínio, risco, IA, criptografia e FHIR
│   │   ├── tests/                  # Testes automatizados da API (unitários e de integração)
│   │   ├── utils/                  # Utilitários de acesso clínico, logger, sanitizador PII
│   │   ├── workers/                # Workers de extração de documentos e ingestão RAG
│   │   ├── openapi.yaml            # Contrato OpenAPI 3.1 oficial e completo
│   │   └── server.js               # Ponto de entrada da aplicação backend
│   └── mobile/                     # Aplicativo mobile Expo / React Native
│       ├── app/                    # Telas baseadas em arquivos (Expo Router)
│       │   ├── (tabs)/             # Abas da gestante (início, diário, exames, chat, perfil)
│       │   └── doctor/             # Telas da jornada médica (dashboard de gravidade, prontuário)
│       ├── assets/                 # Imagens, ícones e fontes da aplicação
│       ├── components/             # Componentes modulares reutilizáveis
│       ├── hooks/                  # Hooks customizados React
│       └── utils/                  # Formatadores, cliente HTTP e helpers do app
├── docs/                           # Documentação técnica consolidada v3, ADRs e releases
│   ├── adr/                        # Registros de Decisões Arquiteturais (ADRs 0001 a 0007)
│   ├── releases/                   # Notas de release (v3.0.0.md), scripts de pitch e vídeo técnico
│   ├── documentacao-tecnica-v3.md  # Guia consolidado de arquitetura, execução e transição
│   ├── er-textual-v3.md            # Modelo relacional textual de entidades e integridade
│   ├── backlog-2027.1.md           # Backlog oficial triado e priorizado para o ciclo 2027.1
│   ├── regras-de-risco.md          # Catálogo completo das regras de risco obstétrico e decisões PO
│   ├── ci-cd.md                    # Contrato agnóstico de provedor para CI/CD e rollback
│   └── e2e-maestro.md              # Guia para execução da suíte de testes E2E com Maestro
├── e2e/                            # Fluxos automatizados de testes ponta a ponta (Maestro)
├── reports/                        # Relatórios sintéticos gerados por scripts de acurácia/validação
├── scripts/                        # Scripts de acurácia, validação cega, eval set e estresse
├── tests/                          # Testes da raiz e fixtures de PDF para benchmark
├── docker-compose.yml              # Orquestração local do PostgreSQL e API
├── .env.example                    # Modelo oficial e documentado de variáveis de ambiente
└── package.json                    # Scripts e dependências raiz do monorepo
```

## Configuração e execução local

### Guia Rápido de Onboarding (≤ 10 minutos)

O projeto dispõe do script automatizado `npm run setup` para preparar todo o ambiente de desenvolvimento local (API, banco de dados e sementes de teste):

1. **Pré-requisitos**:
   - **Node.js**: versão 18 ou superior.
   - **Docker Desktop**: instalado e em execução.

2. **Configuração automática em comando único**:
   Na raiz do repositório, execute:
   ```bash
   npm run setup
   ```
   *O que este comando faz automaticamente:*
   - Valida os pré-requisitos do ambiente (Node.js e Docker daemon).
   - Cria o arquivo `.env` a partir do `.env.example` (se ainda não existir).
   - Gera segredos criptográficos locais seguros (`JWT_SECRET`, `AES_ENCRYPTION_KEY_V1`, `EMAIL_LOOKUP_HMAC_KEY`, `PG_PASSWORD`).
   - Instala as dependências necessárias do monorepo.
   - Inicia o contêiner do PostgreSQL 15 (`docker compose up -d db`).
   - Aguarda a prontidão do banco e aplica automaticamente as migrações pendentes sob advisory lock (`scripts/migrate.js`).
   - Executa os seeds de dados sintéticos (`scripts/seed.js`).

   Após o setup, o comando `npm run seed` pode ser reexecutado para recompor os dados sintéticos sem duplicar registros. A carga inicial cria:
   - 1 administrador (`admin@myfetus.local`);
   - 2 médicos (`medico1@myfetus.local` e `medico2@myfetus.local`);
   - 10 gestantes com gestações ativas, vínculos médico-paciente, consultas e histórico diário.
   
   A senha padrão de todas as contas sintéticas é `SenhaTeste123!` (configurável via variável `SEED_PASSWORD`).

3. **Executar as aplicações**:
   ```bash
   # Em um terminal: Iniciar API Backend (porta 3000)
   npm run dev:api

   # Em outro terminal: Iniciar Aplicativo Mobile (Expo)
   npm run dev:mobile
   ```

4. **Atualizar migrações preservando dados existentes**:
   Se você já possui o volume `db_data` criado e deseja aplicar novas tabelas/colunas sem perder seus dados cadastrados:
   ```bash
   npm run db:migrate
   ```

5. **Resetar o ambiente (opcional)**:
   Para limpar contêineres e recriar o volume do banco de dados do zero:
   ```bash
   npm run docker:reset
   ```

---

### Procedimento Manual Passo a Passo

### 1. Pré-requisitos

- Node.js 18 ou superior.
- npm.
- Docker e Docker Compose.
- Expo Go em dispositivo físico ou emulador Android/iOS.
- Git.

### 2. Clonar o repositório

```bash
git clone https://github.com/felipemrvieira/MyFetus.git
cd MyFetus
```

### 3. Instalar dependências

Na raiz:
```bash
npm install
```

Na API:
```bash
cd apps/api
npm install
```

No mobile:
```bash
cd ../mobile
npm install
```

### 4. Configurar variáveis de ambiente

Volte para a raiz do projeto e crie o arquivo `.env`:
```bash
cd ../..
cp .env.example .env
```

Edite o `.env` e preencha os segredos mínimos. Você pode gerar chaves criptográficas seguras com os utilitários da API:
```bash
cd apps/api
npm run jwt:secret
npm run aes:key
```

Copie as chaves geradas para o seu arquivo `.env`.

### 5. Subir banco e backend com Docker

Na raiz do projeto:
```bash
docker compose up -d db
npm run db:migrate
npm run seed
```

Serviços esperados:

| Serviço | URL/porta | Observação |
|---|---|---|
| API | `http://localhost:3000` | Backend Express 5. |
| Liveness check | `http://localhost:3000/ping` | Validação básica de runtime. |
| Readiness check | `http://localhost:3000/health` | Validação de prontidão e conexão com o banco. |
| Documentação Swagger | `http://localhost:3000/docs/` | Especificação interativa OpenAPI 3.1. |
| PostgreSQL no host | `localhost:5434` | Porta mapeada para acesso local. |
| PostgreSQL na rede Docker | `db:5432` | Endereço interno utilizado pela API em contêiner. |

### 6. Executar o aplicativo mobile

Em outro terminal:
```bash
cd apps/mobile
npm start
```

Atalhos do Expo:
- `a`: Abrir no emulador Android.
- `i`: Abrir no simulador iOS (somente macOS).
- `w`: Abrir no navegador web.

> [!NOTE]
> Em celulares físicos, `EXPO_PUBLIC_API_URL` deve apontar para o endereço IP local da máquina (ex.: `http://192.168.1.15:3000`), pois `localhost` no aparelho direciona para si mesmo.

### Build Android para testes externos

O app possui perfis EAS configurados para gerar APK de pré-visualização e AAB de produção. Consulte [`docs/eas-android-build.md`](docs/eas-android-build.md) para o guia detalhado.

Comando rápido de build para validação:
```bash
cd apps/mobile
npm run build:android:preview
```

## Variáveis de ambiente

O arquivo [`.env.example`](.env.example) na raiz do projeto é a referência canônica de configuração. Segredos reais nunca devem ser commitados no repositório.

### Banco de dados

| Variável | Obrigatória | Exemplo | Descrição |
|---|---|---|---|
| `PG_USER` | Sim | `myfetus_app` | Usuário do PostgreSQL. |
| `PG_PASSWORD` | Sim | `senha_forte` | Senha de conexão ao banco de dados. |
| `PG_DATABASE` | Sim | `myfetus` | Nome do banco relacional. |
| `PG_HOST` | Sim | `db` (ou `localhost` fora do Docker) | Host do banco. |
| `PG_PORT` | Sim | `5432` | Porta interna do banco de dados. |
| `DB_ROTATION_HOST` | Não | `localhost` | Host para scripts de rotação executados no host. |
| `DB_ROTATION_PORT` | Não | `5434` | Porta exposta do PostgreSQL no host. |

### Backend e segurança

| Variável | Obrigatória | Padrão / Exemplo | Descrição |
|---|---|---|---|
| `PORT` | Sim | `3000` | Porta HTTP da API. |
| `NODE_ENV` | Sim | `development` | Ambiente de execução (`development`, `test`, `production`). |
| `JWT_SECRET` | Sim | *(chave segura)* | Segredo para assinatura de tokens JWT. |
| `JWT_EXPIRES_IN` | Não | `8h` | Tempo de expiração da sessão do token. |
| `CORS_ORIGIN` | Sim | `http://localhost:8081,...` | Origens autorizadas para chamadas web/mobile (não aceita `*`). |
| `TRUST_PROXY` | Em prod | `1` | Configuração para proxy reverso em nuvem (ex.: Cloud Run). |
| `ENFORCE_HTTPS` | Em prod | `true` | Força redirecionamento HTTPS em ambiente publicado. |
| `HSTS_MAX_AGE_SECONDS` | Não | `31536000` | Tempo de retenção do cabeçalho de segurança HSTS. |
| `AUTH_RATE_LIMIT_WINDOW_MS` | Não | `900000` (15 min) | Janela de tempo dos limites de requisições de autenticação. |
| `AUTH_RATE_LIMIT_MAX` | Não | `10` | Quantidade máxima de tentativas de login permitidas por janela. |
| `REGISTER_RATE_LIMIT_MAX` | Não | `5` | Quantidade máxima de cadastros de usuários por janela. |
| `ADMIN_READ_RATE_LIMIT_MAX` | Não | `100` | Limite de consultas administrativas por janela. |
| `CLINICAL_RATE_LIMIT_MAX` | Não | `60` | Limite de chamadas às rotas clínicas autenticadas. |
| `DOCS_RATE_LIMIT_MAX` | Não | `300` | Limite de requisições para os endpoints de documentação Swagger. |
| `DATA_EXPORT_RATE_LIMIT_MAX` | Não | `5` | Limite de exportação de dados do titular (LGPD). |
| `ACCOUNT_DELETION_RATE_LIMIT_MAX` | Não | `5` | Limite de tentativas de exclusão de conta pelo titular. |
| `CONSENT_RETENTION_DAYS` | Não | *(vazio)* | Período em dias para retenção de logs de consentimento LGPD. |
| `CONSENT_RETENTION_ACTION` | Não | `anonymize` | Ação de expiração do consentimento (`anonymize` ou `delete`). |

### Criptografia, documentos e IA

| Variável | Obrigatória | Exemplo | Descrição |
|---|---|---|---|
| `AES_KEY_VERSION` | Sim | `1` | Versão ativa da chave criptográfica em repouso. |
| `AES_ENCRYPTION_KEY_V1` | Sim | *(64 caracteres hex / 32 bytes)* | Chave AES-256-GCM para criptografia de dados sensíveis. |
| `EMAIL_LOOKUP_HMAC_KEY` | Sim | *(64 caracteres hex)* | Chave HMAC-SHA256 para indexação e busca de e-mail sem exposição. |
| `DOCUMENT_STORAGE_DIR` | Sim | `uploads/encrypted` | Diretório em disco dos arquivos cifrados em repouso. |
| `DOCUMENT_MAX_UPLOAD_BYTES` | Não | `26214400` (25 MB) | Limite máximo de tamanho por documento enviado. |
| `ENABLE_DOCUMENT_OCR` | Não | `true` | Ativação do fallback de OCR para imagens/documentos escaneados. |
| `PDF_TEXT_MIN_LENGTH_FOR_OCR` | Não | `50` | Limiar de caracteres abaixo do qual o OCR é acionado como fallback. |
| `PINECONE_API_KEY` | Para RAG | *(chave Pinecone)* | Chave de autenticação no banco vetorial Pinecone. |
| `PINECONE_INDEX_NAME` | Para RAG | `myfetus-rag` | Nome do índice no Pinecone. |
| `PINECONE_NAMESPACE` | Para RAG | `guidelines` | Namespace da base de conhecimento clínico no Pinecone. |
| `EMBEDDING_MODEL` | Para RAG | `Xenova/multilingual-e5-small` | Modelo de embedding semântico multilíngue. |
| `EMBEDDING_DIMENSION` | Para RAG | `384` | Dimensão vetorial do modelo de embeddings adotado. |
| `GEMINI_API_KEY` | Para Chat | *(chave Google AI)* | Chave da API do Google Gemini para raciocínio clínico. |
| `GEMINI_MODEL` | Para Chat | `gemini-2.5-flash` | Modelo de linguagem utilizado nas respostas clínicas com citações. |

## Banco de dados

O banco de dados relacional é o PostgreSQL 15. A gestão do schema utiliza migrações SQL aplicadas sob advisory lock por meio do script canônico `apps/api/scripts/migrate.js`, garantindo que nenhuma migração concorrente ocorra e registrando as versões concluídas na tabela `schema_migrations`.

### Scripts SQL principais (`apps/api/db`)

| Arquivo SQL | Finalidade |
|---|---|
| `create_tables.sql` | Estrutura base de usuários, médicos, gestantes, gestações e eventos. |
| `triggers.sql` | Triggers de integridade, cálculo automático e timestamps. |
| `migration.sql` | Ajustes estruturais e campos complementares. |
| `doctor_patient_links.sql` | Modelagem e regras de vínculos entre médicos e gestantes. |
| `migration_security_baseline.sql` | Base de segurança, senhas com hash e regras de integridade. |
| `migration_aes_encryption.sql` | Estrutura de envelopes AES-256-GCM para 110 colunas sensíveis. |
| `migration_document_security.sql` | Armazenamento de metadados de documentos cifrados. |
| `migration_audit_trail.sql` | Trilha de auditoria administrativa append-only. |
| `loinc_table.sql` | Catálogo e estrutura de códigos e analitos LOINC. |
| `migration_sprint6_history.sql` | Tabelas históricas de biometria fetal e peso materno. |
| `migration_consents.sql` | Tabela versionada de registros de consentimento LGPD. |
| `migration_exam_requests.sql` | Pedidos médicos de exames diagnósticos. |
| `migration_doctor_approval.sql` | Controle de aprovação médica de cadastros pelo admin. |
| `migration_daily_entries.sql` | Diário gestacional versionado com envelopes cifrados. |
| `migration_daily_metrics_history.sql` | Séries históricas de métricas agregadas do diário. |
| `migration_alert_events.sql` | Eventos de alerta clínico disparados pelo motor de risco. |
| `migration_alert_event_history.sql` | Trilha histórica de reconhecimento e encerramento de alertas com justificativa. |
| `migration_lab_results.sql` | Resultados laboratoriais extraídos e histórico de revisão médica (`lab_result_reviews`). |
| `migration_device_push_tokens.sql` | Registro cifrado e controle de tokens móveis de push notifications. |
| `migration_consultations.sql` | Consultas pré-natais estruturadas com suporte a encadeamento de adendos. |
| `migration_document_reports.sql` | Devolutivas médicas versionadas vinculadas aos exames. |

### Principais entidades relacionais

| Tabela | Chaves e Relações | Finalidade |
|---|---|---|
| `users` | `id` | Contas de acesso, papéis (`gestante`, `medico`, `admin`) e hash de credenciais. |
| `doctors` | `id`, `user_id` | Dados profissionais dos médicos (CRM, UF, especialidade, aprovação). |
| `pregnants` | `id`, `user_id` | Perfil da gestante, histórico clínico e antecedentes familiares cifrados. |
| `pregnancies` | `id`, `pregnant_id` | Gestação em acompanhamento, DUM, DPP e dados obstétricos correntes. |
| `pregnancy_events` | `id`, `pregnancy_id` | Eventos datados da gestação. |
| `doctor_patient_links` | `id`, `(doctor_id, pregnant_id)` | Vínculos médicos com status (`active`, `inactive`) para controle IDOR. |
| `pregnant_documents` | `id`, `pregnant_id` | Documentos laboratoriais enviados, caminho cifrado e status do worker. |
| `exam_requests` | `id`, `pregnant_id`, `doctor_id` | Pedidos formais de exames emitidos por médicos vinculados. |
| `lab_results` | `id`, `document_id`, `pregnant_id` | Analitos laboratoriais extraídos com valor original e valor vigente. |
| `lab_result_reviews` | `id`, `lab_result_id` | Histórico append-only de aceite, correção, rejeição e reabertura de exames. |
| `document_reports` | `id`, `document_id` | Devolutivas médicas versionadas vinculadas ao documento analisado. |
| `consultations` | `id`, `pregnancy_id`, `parent_consultation_id` | Consultas obstétricas com suporte a adendos cronológicos auditáveis. |
| `daily_entries` | `id`, `entry_key`, `pregnant_id` | Diário gestacional versionado (humor, contrações, sintomas em envelopes AES). |
| `alert_events` | `id`, `alert_key`, `pregnancy_id` | Alertas clínicos de triagem deduplicados por chave de risco. |
| `alert_event_history` | `id`, `alert_event_id` | Trilha de auditoria das ações médicas sobre os alertas (reconhecimento/fechamento). |
| `fetal_biometry_history` | `id`, `pregnancy_id` | Séries históricas de biometria fetal (Hadlock) e percentis calculados. |
| `maternal_weight_history` | `id`, `pregnancy_id` | Histórico de pesagens maternas associado à curva de Atalah. |
| `device_push_tokens` | `id`, `user_id` | Tokens de push notification para dispositivos móveis com status de revogação. |
| `consents` | `id`, `user_id` | Registros versionados de consentimento LGPD dos usuários. |
| `audit_logs` | `id` | Registro imutável de ações administrativas e acessos clínicos. |
| `schema_migrations` | `version` | Tabela de controle que registra todas as migrações aplicadas no ambiente. |

### Ciclo de vida e Migrações

- **Inicialização em volume limpo**: O contêiner PostgreSQL executa os scripts de `/docker-entrypoint-initdb.d/` na inicialização do volume e registra as migrações em `schema_migrations`.
- **Atualização com preservação de dados**: Em volumes existentes, execute:
  ```bash
  npm run db:migrate
  ```
  O script `apps/api/scripts/migrate.js` adquire um *PostgreSQL Advisory Lock*, verifica as versões pendentes em `schema_migrations` e aplica cada arquivo SQL dentro de sua própria transação atômica.

## API

URL base da API local:
```text
http://localhost:3000/api
```

### Documentação OpenAPI (Swagger)

A API possui especificação OpenAPI 3.1 versionada em [`apps/api/openapi.yaml`](apps/api/openapi.yaml). O contrato é verificado continuamente por testes automatizados (`tests/openapiContract.test.js`) que validam se todas as rotas declaradas no Express possuem documentação correspondente, segurança e anotações de papéis (`x-roles`).

- **Interface Swagger UI**: `http://localhost:3000/docs/`
- **Especificação em JSON**: `http://localhost:3000/docs/openapi.json`
- **Validação de contrato local**:
  ```bash
  cd apps/api
  npm run docs:check
  ```

### Rotas principais

| Método | Rota | Autenticação | Descrição |
|---|---|---|---|
| `GET` | `/ping` | Pública | Healthcheck básico de liveness. |
| `GET` | `/health` | Pública | Readiness check validando conexão ativa com o PostgreSQL. |
| `POST` | `/api/users` | Pública | Cadastro de usuário gestante com aceite de consentimento LGPD. |
| `POST` | `/api/users/login` | Pública | Autenticação de usuários, retornando JWT e consentimentos pendentes. |
| `GET` | `/api/users/{id}` | JWT | Consulta de dados cadastrais do próprio usuário. |
| `GET` | `/api/consents/policy` | Pública | Catálogo de finalidades, termos de uso e políticas LGPD vigentes. |
| `GET` | `/api/consents/me` | JWT | Consulta de status dos consentimentos do usuário logado. |
| `POST` | `/api/consents` | JWT | Registro de aceite, recusa ou revogação de termo pelo titular. |
| `POST` | `/api/privacy/export` | JWT | Exportação estruturada dos dados pessoais do titular (confirma senha). |
| `DELETE` | `/api/privacy/delete` | JWT | Exclusão definitiva e irreversível da conta pelo titular (confirma senha). |
| `POST` | `/api/doctors` | Pública | Cadastro de médico (submetido a aprovação administrativa). |
| `GET` | `/api/doctors/me/dashboard` | Médico | Dashboard clínico de gestantes ordenado por gravidade de alertas. |
| `GET` | `/api/doctors/me/approval` | Médico | Consulta o status de aprovação cadastral do médico. |
| `GET` | `/api/pregnants` | Médico / Admin | Lista de gestantes cadastradas. |
| `GET` | `/api/pregnants/{id}` | Vínculo / Admin | Consulta dados e prontuário completo de uma gestante. |
| `GET` | `/api/pregnancies` | Gestante / Vínculo | Lista gestações vinculadas. |
| `POST` | `/api/pregnancies` | Gestante / Vínculo | Registro de nova gestação. |
| `POST` | `/api/daily-entries` | Gestante / Admin | Registro diário versionado de sintomas, humor e métricas com alarmes. |
| `GET` | `/api/daily-entries/pregnancies/{pregnancyId}` | Gestante / Vínculo | Consulta de entradas diárias por gestação. |
| `GET` | `/api/daily-entries/pregnancies/{pregnancyId}/metrics` | Gestante / Vínculo | Série histórica de métricas diárias (hidratação, peso, etc.). |
| `GET` | `/api/alert-events/pregnancies/{pregnancyId}` | Gestante / Vínculo | Lista alertas clínicos de triagem obstétrica. |
| `POST` | `/api/alert-events/{alertId}/acknowledge` | Médico vinculado | Reconhecimento formal de alerta com justificativa. |
| `POST` | `/api/alert-events/{alertId}/close` | Médico vinculado | Encerramento de alerta clínico com registro de justificativa. |
| `GET` | `/api/alert-events/{alertId}/history` | Médico vinculado | Trilha histórica auditável das ações tomadas sobre o alerta. |
| `POST` | `/api/documents` | Vínculo / Admin | Upload de exame/documento com armazenamento cifrado AES-GCM. |
| `GET` | `/api/documents/{id}/download` | Vínculo / Admin | Download seguro e descriptografado do arquivo original. |
| `GET` | `/api/documents/{id}/text` | Vínculo / Admin | Consulta texto clínico extraído (PDF.js ou OCR). |
| `POST` | `/api/documents/{id}/extract` | Médico / Admin | Solicitação de reprocessamento manual de extração de texto. |
| `GET` | `/api/lab-results/documents/{documentId}` | Vínculo / Admin | Analitos laboratoriais estruturados extraídos do exame. |
| `POST` | `/api/lab-results/{id}/accept` | Médico vinculado | Homologação e aceite médico do analito extraído. |
| `POST` | `/api/lab-results/{id}/correct` | Médico vinculado | Correção de valor ou unidade de referência do analito extraído. |
| `POST` | `/api/lab-results/{id}/reject` | Médico vinculado | Rejeição clínica do resultado extraído com justificativa. |
| `GET` | `/api/lab-results/pregnant/{id}/series/{analyteId}` | Vínculo / Admin | Série temporal histórica de um analito ao longo da gestação. |
| `POST` | `/api/document-reports/documents/{documentId}` | Médico vinculado | Criação e publicação de devolutiva médica versionada para o exame. |
| `GET` | `/api/consultations/pregnancies/{pregnancyId}` | Vínculo / Admin | Histórico de consultas obstétricas da gestação. |
| `POST` | `/api/consultations/pregnancies/{pregnancyId}` | Médico vinculado | Registro de nova consulta médica. |
| `POST` | `/api/consultations/{id}/addenda` | Médico vinculado | Inclusão de adendo cronológico e auditável à consulta. |
| `GET` | `/api/reports/pregnancies/{pregnancyId}/snapshot` | Vínculo / Admin | Snapshot consolidado dos dados obstétricos para auditoria. |
| `GET` | `/api/reports/pregnancies/{pregnancyId}/pdf` | Vínculo / Admin | Geração e download do relatório obstétrico consolidado em PDF. |
| `POST` | `/api/notifications/devices` | JWT | Registro e atualização de device push token para notificações. |
| `GET` | `/api/exports/pregnancies/{pregnancyId}/fhir` | Vínculo / Admin | Exportação do prontuário gestacional em formato FHIR Bundle. |
| `GET` | `/api/history/pregnancies/{pregnancyId}` | Vínculo / Admin | Histórico longitudinal de biometria fetal e ganho de peso materno. |
| `GET` | `/api/growth/chart` | JWT | Dados para plotagem de curvas de Hadlock e Atalah. |
| `POST` | `/api/internal/rag/search` | JWT | Busca semântica de trechos normativos na base clínica. |
| `POST` | `/api/internal/rag/chat` | JWT | Chat clínico com contextualização RAG, citações e guardrails. |
| `GET` | `/api/admin/audit` | Admin | Trilha de auditoria das ações administrativas e acessos clínicos. |

## Processamento de documentos

O pipeline de processamento de exames e relatórios médicos opera de forma assíncrona e desacoplada:

```text
Upload do exame cifrado (AES-GCM)
              |
              v
Registro em pregnant_documents (status: pending)
              |
              v
Worker assíncrono de extração (extractDocuments.js)
              |
   -----------------------
   |                     |
PDF.js nativo       OCR Fallback
(texto direto)     (Tesseract.js)
   |                     |
   -----------------------
              |
              v
Texto extraído sanitizado (extracted_text)
              |
              v
Parser de exames laboratoriais + normalização LOINC
              |
              v
Resultados estruturados em lab_results
              |
              v
Revisão médica versionada (aceitar / corrigir / rejeitar)
              |
              v
Acionamento de regras do motor de risco (se aprovado)
```

### Dataset sintético de extração

Para assegurar testes rigorosos sem violar a privacidade de pacientes reais, o projeto mantém um gerador determinístico de fixtures sintéticas (E2-09):
- 50 PDFs nativos sintéticos com variações de layout de 3 laboratórios fictícios;
- 25 exames escaneados com ruído e rotações gerados dinamicamente para validação do OCR;
- Limiares técnicos mínimos: 90% de sobreposição de tokens para PDF.js e 70% para OCR.

Geração e execução do relatório de acurácia:
```bash
npm run generate:dataset:ocr
npm run accuracy:pdf
```

## RAG e chat clínico

O módulo RAG fornece suporte à decisão e consultas educativas, ancorado exclusivamente em publicações oficiais autorizadas no manifesto de fontes (Ministério da Saúde e FEBRASGO).

### Componentes e fluxo

1. **Ingestão controlada**: Processamento de documentos com chunking determinístico (900 caracteres, sobreposição de 150 caracteres) e geração de embeddings locais (`Xenova/multilingual-e5-small`).
2. **Armazenamento vetorial**: Vetores e metadados estruturados armazenados no Pinecone sob o namespace `guidelines`.
3. **Guardrails de segurança**:
   - **Sanitização de PII**: Remoção de CPF, nomes, telefones e e-mails antes de enviar o contexto ao modelo.
   - **Detecção de Emergências**: Sinais de alarme obstétrico disparam mensagens de orientação imediata para pronto atendimento, sem resposta especulativa.
   - **Classificação de Escopo**: Perguntas fora da temática materno-fetal recebem recusa padronizada.
   - **Anti-Prompt Injection**: Filtros contra tentativas de escape de instruções clínicas.
4. **Geração com citações**: A resposta gerada pelo Google Gemini obrigatoriamente inclui referências e citações das páginas e diretrizes utilizadas.
5. **Suíte de avaliação (`npm run rag:eval`)**: 50 questões clínicas com gabarito formal avaliam sistematicamente precisão, revocação e presença de citações.

Execução da avaliação de RAG:
```bash
cd apps/api
npm run rag:eval
```

## Segurança e privacidade

A arquitetura do MyFetus adota o princípio de *Privacy and Security by Design*:

- **Criptografia em repouso**: Todas as colunas com dados clínicos sensíveis utilizam envelopes criptográficos AES-256-GCM com vetores de inicialização (IV) únicos e versionamento de chaves (`AES_KEY_VERSION`).
- **Anonimização de busca de e-mail**: E-mails de usuários são indexados via HMAC-SHA256 (`EMAIL_LOOKUP_HMAC_KEY`), permitindo busca exata sem expor e-mails em texto plano no banco.
- **Armazenamento seguro de arquivos**: PDFs e imagens são cifrados no momento do upload antes da escrita no disco e descriptografados sob demanda em streaming protegido.
- **Prevenção a IDOR e autorização contextual**: O acesso a dados clínicos de gestantes exige verificação em tempo de execução via `ensureCanAccessPregnant`, conferindo papel e existência de vínculo ativo em `doctor_patient_links`.
- **Trilha de auditoria append-only**: A tabela `audit_logs` registra todas as ações críticas, sendo imune a exclusões ou alterações por usuários convencionais.
- **Conformidade LGPD**:
  - Aceite de termos e políticas versionadas com trilha temporal (`/api/consents`);
  - Portabilidade de dados através do endpoint `/api/privacy/export`;
  - Direito de exclusão definitiva da conta através de `/api/privacy/delete`, exigindo reautenticação com senha.

## Testes

### Testes na raiz

| Comando | O que valida |
|---|---|
| `npm test` | Executa os testes Jest configurados na raiz do monorepo. |
| `npm run test:pdf-extractor` | Valida extração de texto em fixtures sintéticas de exames PDF. |
| `npm run accuracy:pdf` | Executa o benchmark de acurácia de extração em lote. |
| `npm run generate:dataset` | Gera fixtures sintéticas de PDFs nativos para validação. |
| `npm run generate:dataset:ocr` | Gera fixtures sintéticas renderizadas com imagens para validação do OCR. |
| `npm run test:stress` | Executa simulações de estresse no motor RAG e serviços da API. |

### Testes da API (`apps/api`)

| Comando | O que valida |
|---|---|
| `npm run test:ci` | **Suíte canônica do CI**: executa os testes unitários, integrados, de risco e RAG. |
| `npm run docs:check` | Valida a conformidade estrita entre as rotas do Express e o contrato OpenAPI 3.1. |
| `npm run rag:eval` | Executa o avaliador de recuperação e qualidade do RAG sobre o eval set de 50 casos. |
| `npm run blind-validation:run` | Executa a validação cega das regras do motor de risco obstétrico. |
| `npm run blind-validation:compare`| Compara os resultados algorítmicos com o parecer médico na validação cega. |
| `npm run test:pii` | Valida sanitização de dados pessoais em logs e prompts. |
| `npm run test:crypto` | Testa rotinas de criptografia AES-256-GCM e HMAC. |
| `npm run test:clinical-crypto` | Testa a proteção criptográfica nos dados clínicos em repouso. |
| `npm run test:file-crypto` | Valida a integridade e segurança de arquivos cifrados em disco. |
| `npm run test:rag` | Testa o pipeline de chunking, embeddings e busca vetorial no Pinecone. |
| `npm run test:security-baseline` | Valida a base de segurança e configurações HTTP da API. |

### Testes do mobile (`apps/mobile`)

| Comando | O que valida |
|---|---|
| `npm run lint` | Validação de estilo e boas práticas de código via ESLint. |
| `npm run typecheck` | Verificação estática de tipos via TypeScript compiler. |
| `npm run test:ci` | Execução dos testes automatizados configurados para o app. |

### Testes End-to-End móveis com Maestro (`e2e`)

O projeto possui fluxos E2E automatizados utilizando Maestro para testar o aplicativo em emuladores:
```bash
# Executar fluxo E2E de login e navegação
maestro test e2e/flows/login-flow.yaml
```
Consulte o guia completo em [`docs/e2e-maestro.md`](docs/e2e-maestro.md).

### Fluxo recomendado antes de abrir PR

```bash
# 1. Validações na raiz
npm test
npm run test:pdf-extractor

# 2. Validações na API
cd apps/api
npm run test:ci
npm run docs:check

# 3. Validações no Mobile
cd ../mobile
npm run lint
npm run typecheck
```

## CI/CD e deploy

A arquitetura e os contratos de implantação contínua estão documentados em [`docs/ci-cd.md`](docs/ci-cd.md) e [`docs/ci-cd-gcp-staging.md`](docs/ci-cd-gcp-staging.md).

### Pipeline do GitHub Actions

1. **Pull Requests (`ci.yml`)**:
   - Lint, typecheck e auditoria de vulnerabilidades (`npm audit`);
   - Execução das suítes de testes unitários e de integração;
   - Verificação de sincronia do contrato OpenAPI (`docs:check`);
   - Análise estática de segurança com CodeQL;
   - Validação da extração e OCR com dataset sintético;
   - Build de teste da imagem Docker.

2. **Deploy de homologação (`cd-staging.yml`)**:
   - Acionado após aprovação do environment `staging` em commits mergeados em `main`;
   - Autenticação com o Google Cloud via OIDC (Workload Identity Federation), sem credenciais JSON fixas;
   - Build e publicação da imagem Docker no Google Artifact Registry com tag associada ao SHA do commit;
   - Execução das migrações do PostgreSQL utilizando a mesma imagem Docker antes do direcionamento de tráfego;
   - Atualização do serviço no Google Cloud Run com HTTPS gerenciado;
   - Execução de smoke tests HTTPS automatizados checando `/ping`, `/health` e endpoints protegidos.

> [!WARNING]
> O ambiente de homologação destina-se exclusivamente a validação funcional com **dados sintéticos**. É expressamente proibido inserir dados reais de pacientes em homologação.

## Scripts úteis

### Raiz

```bash
npm run setup                 # Configuração automática do ambiente local (banco, .env, seed)
npm run seed                  # Executa carga de dados sintéticos de teste
npm run db:migrate            # Aplica migrações pendentes com advisory lock
npm run docker:up             # Sobe o contêiner do PostgreSQL
npm run docker:down           # Para os contêineres Docker
npm run docker:reset          # Limpa e recria o volume do banco local
npm run dev:api               # Inicia a API backend localmente (porta 3000)
npm run dev:mobile            # Inicia o servidor Expo do aplicativo mobile
npm test                      # Executa testes unitários na raiz
npm run generate:dataset      # Gera fixtures de PDFs nativos sintéticos
npm run generate:dataset:ocr  # Gera fixtures com imagens para validação de OCR
npm run accuracy:pdf          # Emite relatório de acurácia de extração de exames
```

### API (`apps/api`)

```bash
npm run dev                   # Inicia a API em modo de desenvolvimento
npm run test:ci               # Roda a suíte completa de testes de integração e unitários
npm run docs:check            # Valida o contrato OpenAPI contra os endpoints declarados
npm run rag:eval              # Executa a suíte de avaliação quantitativa do RAG
npm run blind-validation:run  # Executa a suíte de validação cega das regras de risco
npm run jwt:secret            # Gera um segredo JWT seguro
npm run aes:key               # Gera uma chave criptográfica AES-256 válida
npm run jwt:rotate            # Executa a rotação de segredo JWT em produção
npm run db:rotate-password    # Executa a rotação da senha de banco de dados
npm run extract:documents     # Dispara manualmente a fila de processamento do worker
npm run rag:ingest            # Inicia o pipeline de ingestão de documentos na base RAG
```

### Mobile (`apps/mobile`)

```bash
npm start                     # Inicia o bundler Metro do Expo
npm run android               # Executa o app no emulador Android
npm run ios                   # Executa o app no simulador iOS (macOS)
npm run lint                  # Executa verificação de padrões de código
npm run typecheck             # Executa verificação de tipos TypeScript
npm run build:android:preview # Gera APK de pré-visualização para testes via EAS
```

## Credenciais de teste

O script de inicialização `npm run setup` ou `npm run seed` gera contas de testes padronizadas com dados sintéticos locais:

- **Senha padrão para todas as contas sintéticas**: `SenhaTeste123!`

| Perfil | E-mail | Descrição |
|---|---|---|
| Administrador | `admin@myfetus.local` | Acesso irrestrito a auditoria, aprovação médica e sincronização. |
| Médico 1 | `medico1@myfetus.local` | Médico com CRM ativo, vinculado a gestantes e com dashboard populado. |
| Médico 2 | `medico2@myfetus.local` | Médico com CRM ativo e vínculos independentes. |
| Gestante 1 | `gestante1@myfetus.local` | Gestante com histórico de diário, exames enviados e consultas. |
| Gestantes 2 a 10 | `gestante2@myfetus.local` a `gestante10@myfetus.local` | Gestantes com idades gestacionais variadas e alertas simulados. |

### Criação manual de usuários via API

#### Criar gestante

```bash
curl -X POST http://localhost:3000/api/users \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Maria Silva Teste",
    "email": "maria.teste@example.com",
    "password": "SenhaTeste123!",
    "role": "gestante"
  }'
```

#### Criar médico

```bash
curl -X POST http://localhost:3000/api/doctors \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Dr. Carlos Teste",
    "email": "carlos.medico@example.com",
    "password": "SenhaTeste123!",
    "crm": "123456",
    "specialty": "Obstetricia",
    "phone": "81999999999"
  }'
```

#### Obter Token JWT (Login)

```bash
curl -X POST http://localhost:3000/api/users/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "maria.teste@example.com",
    "password": "SenhaTeste123!"
  }'
```

Inclua o token retornado no cabeçalho de requisições autenticadas:
```http
Authorization: Bearer <seu_token_jwt>
```

## Bugs conhecidos

No momento do encerramento do ciclo 2026.2 (freeze de homologação), **nenhum bug bloqueante de severidade P1 permanece aberto**.

Caso identifique comportamentos anômalos durante o ciclo 2027.1, registre uma issue no GitHub categorizada de acordo com as regras de severidade do projeto:
- **P1 (Crítico)**: Interrompe a jornada principal, expõe dados pessoais/clínicos ou gera orientação médica incorreta. Bloqueia a liberação de versões de teste.
- **P2 (Alto)**: Falha importante em funcionalidade secundária que possui alternativa ou contorno seguro documentado.
- **P3 (Médio/Baixo)**: Ajustes cosméticos, melhorias de usabilidade ou otimizações de performance sem quebra de jornada.

## Limitações e backlog futuro

O planejamento para a próxima equipe de desenvolvimento (ciclo 2027.1) encontra-se detalhado e triado em [`docs/backlog-2027.1.md`](docs/backlog-2027.1.md). Os tópicos priorizados incluem:

| Prioridade | Item | Descrição e Critério de Aceite |
|---|---|---|
| **P0** | **Ambiente de Produção Real** | Definição da arquitetura e provisionamento de infraestrutura de produção isolada, domínio próprio, certificados HTTPS, observabilidade avançada e política de backup/restore. |
| **P0** | **Interoperabilidade RNDS** | Integração formal com a Rede Nacional de Dados em Saúde (RNDS/DATASUS) utilizando perfis e credenciais institucionais validadas. |
| **P1** | **Perfil de Enfermagem (#113 / E6-05)** | Implementação do papel assistencial de enfermagem com matriz de permissões específica e leitura mínima necessária aprovada pelo PO. |
| **P1** | **Assinatura Digital de Documentos** | Incorporação de assinatura digital com certificado ICP-Brasil em relatórios obstétricos e prontuários médicos. |
| **P1** | **Achados do Piloto de Usabilidade (#72 / #73)** | Tratamento e priorização dos feedbacks colhidos nas sessões de teste com usuários reais. |
| **P1** | **Geração de PDF de Consultas (#135)** | Implementação da exportação formal em PDF para o resumo e adendos da consulta pré-natal. |
| **P1** | **Disparo Efetivo de Push Notifications (#132)** | Conexão do serviço de push (Firebase Cloud Messaging / APNs) para envio ativo de notificações em dispositivos móveis. |
| **P1** | **Expansão de Fontes e Governança do RAG** | Aprovação de novos cadernos clínicos pelo PO e monitoramento contínuo de custos e latência da LLM. |
| **P2** | **Protocolo de Pesquisa Clínica (#116 / E8-07)** | Submissão de protocolo a Comitê de Ética em Pesquisa (CEP) antes de estudos com participantes humanos. |
| **P2** | **Testes E2E Abrangentes e Testes de Carga** | Expansão dos testes E2E com Maestro e execução automatizada de testes de carga em ambiente efêmero. |
| **P2** | **Telemetria e Observabilidade** | Implantação de métricas de infraestrutura, tracing distribuído e dashboards de saúde da API. |

## Troubleshooting

### `docker compose up` falha por variáveis ausentes

Certifique-se de que o arquivo `.env` existe na raiz do repositório e contém valores para `PG_USER`, `PG_PASSWORD`, `PG_DATABASE`, `JWT_SECRET` e `AES_ENCRYPTION_KEY_V1`. O comando `npm run setup` gera essas chaves automaticamente.

### API inicializa, mas o aplicativo mobile não conecta

- **No emulador Android**: O app deve apontar para `http://10.0.2.2:3000` em vez de `localhost`.
- **Em dispositivo físico**: Configure `EXPO_PUBLIC_API_URL` com o endereço IP local da máquina na rede Wi-Fi (ex.: `http://192.168.0.25:3000`).
- Verifique se a origem da chamada está contemplada na variável `CORS_ORIGIN` no `.env`.
- Teste a comunicação executando `curl http://localhost:3000/ping`.

### Migrações bloqueadas ou travadas por Advisory Lock

Se uma migração foi interrompida no meio, o lock transacional pode persistir temporariamente. Reinicie o contêiner do banco com:
```bash
docker compose restart db
```

### Erro de "Token inválido" ou "Unauthorized"

- Certifique-se de que a API e os testes utilizam o mesmo `JWT_SECRET`.
- Se o segredo foi rotacionado via script, gere um novo token de autenticação realizando login novamente.
- Confirme se o usuário autenticado possui o papel (`role`) exigido pela rota.

### Erros no módulo RAG ou ausência de respostas da IA

- Verifique se as variáveis `PINECONE_API_KEY`, `PINECONE_INDEX_NAME` e `PINECONE_NAMESPACE` estão preenchidas no `.env`.
- Assegure-se de que `GEMINI_API_KEY` possui cota disponível no Google AI Studio.
- O RAG é opcional para o desenvolvimento básico da API. Se os serviços externos não estiverem configurados, a API trata os recursos de IA como indisponíveis sem comprometer os fluxos clínicos centrais.

### Falha no upload ou extração de exames em PDF

- Verifique se o diretório configurado em `DOCUMENT_STORAGE_DIR` possui permissões de escrita para a aplicação.
- Certifique-se de que o arquivo enviado não excede `DOCUMENT_MAX_UPLOAD_BYTES` (padrão de 25 MB).
- Execute o teste unitário isolado: `npm run test:pdf-extractor`.

## Documentação técnica v3

O guia consolidado de arquitetura, execução, segurança, testes, limitações, perguntas de transição e checklist operacional de continuidade está documentado em:
- [**Documentação Técnica v3**](docs/documentacao-tecnica-v3.md) — Referência canônica para a transição de equipes.
- [**ER Textual v3**](docs/er-textual-v3.md) — Inventário completo de entidades, chaves relacionais, integridade e ordem executável de migrações.
- [**Release Notes v3.0.0**](docs/releases/v3.0.0.md) — Critérios de freeze, notas de release e demo mínima aprovada.
- [**Backlog Triado 2027.1**](docs/backlog-2027.1.md) — Planejamento e priorização das demandas para a próxima equipe.

## Documentação complementar

| Arquivo | Conteúdo e Finalidade |
|---|---|
| [**Projeto Completo e Documento de Negócio — MyFetus 3.0 (PDF)**](docs/MyFetus%203.0%20-%20Projeto%20Completo%20e%20Documento%20de%20Negocio.pdf) | Planejamento do ciclo 2026.2 e Documento de Negócio do MyFetus 3.0. |
| [`docs/ci-cd.md`](docs/ci-cd.md) | Contrato de CI/CD, esteiras de deploy, smoke tests e procedimentos de rollback. |
| [`docs/ci-cd-gcp-staging.md`](docs/ci-cd-gcp-staging.md) | Arquitetura e operação detalhada da homologação no Google Cloud Platform. |
| [`docs/regras-de-risco.md`](docs/regras-de-risco.md) | Catálogo normativo das 12 categorias de risco obstétrico e decisões clínicas do PO. |
| [`docs/e2e-maestro.md`](docs/e2e-maestro.md) | Guia para execução e criação de fluxos de testes E2E móveis com Maestro. |
| [`docs/adr/`](docs/adr/) | Arquivo de Decisões Arquiteturais registradas (ADRs 0001 a 0007). |
| [`docs/adr/0007-servicos-externos-custo-zero.md`](docs/adr/0007-servicos-externos-custo-zero.md) | Diretriz sobre o uso de serviços em nuvem gratuitos ou patrocinados em ambiente acadêmico. |
| [`docs/lgpd/consentimento.md`](docs/lgpd/consentimento.md) | Diretrizes e modelos de consentimento informado segundo a LGPD. |
| [`apps/api/openapi.yaml`](apps/api/openapi.yaml) | Especificação completa do contrato OpenAPI 3.1 da API REST. |
| [`apps/api/API_USAGE.md`](apps/api/API_USAGE.md) | Exemplos de chamadas HTTP e cenários de uso da API. |
| [`apps/api/CURL_RAG_EXAMPLES.md`](apps/api/CURL_RAG_EXAMPLES.md) | Exemplos de requisições `curl` para os endpoints do módulo RAG. |
| [`apps/mobile/README.md`](apps/mobile/README.md) | Instruções específicas para desenvolvimento e execução do app móvel. |
| [`GLOSSARY.md`](GLOSSARY.md) | Glossário de termos técnicos, clínicos e regulatórios do MyFetus. |
| [`CHANGELOG.md`](CHANGELOG.md) | Histórico de alterações e marcos evolutivos do projeto. |

## Licença e uso

Projeto acadêmico de saúde digital desenvolvido no âmbito da disciplina de Engenharia de Software da Universidade de Pernambuco (POLI/UPE).

> [!IMPORTANT]
> Este software constitui um ambiente acadêmico de homologação e validação de engenharia de software. Não possui certificação como dispositivo médico, não substitui parecer ou consulta médica presencial e **não deve ser utilizado em ambiente assistencial real com dados de pacientes vivos** sem as devidas aprovações institucionais, éticas (CEP/CONEP) e regulatórias (Anvisa/CFM).
