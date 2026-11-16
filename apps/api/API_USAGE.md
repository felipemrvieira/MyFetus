# API Usage — MyFetus (Backend)

Este documento descreve como usar os endpoints do backend do projeto MyFetus. Inclui exemplos `curl`, payloads esperados e observações importantes.

**Rodando a API**

- Usando Docker Compose (recomendado):

```bash
# a partir da raiz do projeto
docker compose up -d --build
# reiniciar apenas o backend após alterações de código
docker compose restart backend
```

- Variáveis de ambiente obrigatórias:
  - `PG_USER`
  - `PG_PASSWORD`
  - `PG_DATABASE`
  - `PG_HOST`
  - `PG_PORT` (default `5432`)
  - `PORT` (default `3000`)
  - `JWT_SECRET` (obrigatório para rotas autenticadas)
  - `JWT_EXPIRES_IN` (default `8h`)
  - `CORS_ORIGIN` (origens permitidas separadas por vírgula)

Base URL padrão: `http://localhost:3000/api`

Observação: o servidor expõe `/api` como prefixo de todas as rotas.

### JWT de teste

Para gerar um valor de `JWT_SECRET`, use:

```bash
npm run jwt:secret
```

Para rotacionar o segredo no `.env` local:

```bash
npm run jwt:rotate
```

O comando não imprime o novo segredo. Tokens emitidos anteriormente deixam de
ser válidos. Use `npm run jwt:rotate -- --restart` para também recriar o backend.

### JWT de teste sem rotacionar segredo

Para gerar um token válido com o `JWT_SECRET` atual do `.env`, use:

```bash
npm run jwt:test-token
```

O comando imprime apenas um JWT de `admin` para desenvolvimento local.

Use esse fluxo quando quiser apenas autenticar chamadas locais sem alterar a configuração do backend.

Se preferir usar a JWT gerada manualmente em outro request, copie o token impresso e envie no header:

```bash
Authorization: Bearer <token-gerado>
```

---

**Restrições e observações**

- Campo `role` em `users` aceita apenas: `gestante`, `medico`, `admin`.
- Uploads de documentos usam `multer` e salvam arquivos em `uploads/`.
- O script de testes está em `apps/api/test_api.sh` e verifica os principais endpoints.
- O comando `npm run jwt:test-token` usa o `JWT_SECRET` do `.env` sem rotacioná-lo.

---

## Endpoints principais

> O contrato completo e atualizado (todas as rotas, papéis, corpos, respostas e erros) está em
> [`openapi.yaml`](openapi.yaml) e pode ser navegado em `http://localhost:3000/docs/` com a API rodando.
> Os exemplos abaixo são atalhos práticos; em caso de divergência, vale o `openapi.yaml`.

Todos os exemplos usam `curl`. Substitua `localhost:3000` se necessário.

### Users

- Criar usuário
  - POST `/api/users` (cadastro público; cria conta com papel `gestante`)
  - JSON: `name`, `email`, `password` (8+ caracteres), `birthdate` (YYYY-MM-DD) e `consents`
    com o aceite da versão vigente de `GET /api/consents/policy` (E7-01.1)

Exemplo:

```bash
curl -X POST http://localhost:3000/api/users \
  -H "Content-Type: application/json" \
  -d '{"name":"João","email":"joao@example.com","password":"senha-sintetica-123","birthdate":"1990-05-15","consents":[{"purpose":"termos_de_uso_gestante","version":"0.1-rascunho"},{"purpose":"politica_de_privacidade","version":"0.1-rascunho"},{"purpose":"tratamento_dados_saude","version":"0.1-rascunho"}]}'
```

- Listar usuários: GET `/api/users`
- Buscar por id: GET `/api/users/:id`
- Atualizar: PUT `/api/users/:id` (envia JSON com campos a alterar; se `password` será criptografada)
- Deletar: DELETE `/api/users/:id`
- Login: POST `/api/users/login` — body: `{ "email": "...", "password": "..." }`

### Aprovação de médicos (E7-03)

O cadastro público de médico cria o perfil com `approval_status: pending`. O
login continua respondendo `200`, mas qualquer rota clínica que aceite o papel
`medico` responde `403` com `code: DOCTOR_APPROVAL_REQUIRED` até a aprovação.

- Listar médicos para decisão: `GET /api/doctors?approval_status=pending` (admin)
- Aprovar: `POST /api/doctors/:id/approval` com `{ "decision": "approve" }` (admin)
- Rejeitar: o mesmo endpoint com `{ "decision": "reject", "reason": "..." }` (admin)
- Revogar: o mesmo endpoint com `{ "decision": "revoke", "reason": "..." }` (admin)
- Consultar o próprio estado: `GET /api/doctors/me/approval` (médico)
- Reenviar dados corrigidos: `PUT /api/doctors/me` com `crm`, `crm_estado` e campos profissionais (médico rejeitado/revogado)

O CRM é armazenado cifrado e sua unicidade por CRM+UF é verificada por HMAC;
o valor bruto não é usado para consulta. Todas as decisões administrativas
geram auditoria. As contas sintéticas do `npm run seed` são marcadas como
`is_synthetic` e aprovadas somente para desenvolvimento/testes locais.

---

### Pregnants (gestantes)

- Criar gestante: POST `/api/pregnants`
  - JSON: `{ "user_id": <userId> }`

Exemplo:

```bash
curl -X POST http://localhost:3000/api/pregnants \
  -H "Content-Type: application/json" \
  -d '{"user_id":4}'
```

- Listar: GET `/api/pregnants`
- Consultar por id: GET `/api/pregnants/:id`
- Atualizar: PUT `/api/pregnants/:id` (envia JSON com os campos suportados — ex.: `altura`, `peso_atual`, `pressao_sistole`, etc.)

Observação: a listagem de gestantes faz JOIN com `users` e filtra por `role = 'user'` (comportamento implementado no controller).

---

### Pregnancies (gestações)

Todas as rotas exigem `Authorization: Bearer <token>`.
Listagem e criação respeitam o acesso da gestante ao próprio registro, do médico às gestantes vinculadas, e do admin a todas.

- Criar: POST `/api/pregnancies`
  - JSON obrigatório: `pregnant_id`, `dum`, `dpp`, `ig_ultrassonografia` + outros campos opcionais (`weeks`, `glicemia`, `frequencia_cardiaca`, ...)

Exemplo:

```bash
curl -X POST http://localhost:3000/api/pregnancies \
  -H "Content-Type: application/json" \
  -d '{"pregnant_id":4,"weeks":10,"dum":"2025-02-01","dpp":"2025-11-01","ig_ultrassonografia":"2025-02-15"}'
```

- Listar: GET `/api/pregnancies`
- Atualizar: PUT `/api/pregnancies/:id` (`medico` ou `admin`; envia campos a alterar: `glicemia`, `frequencia_cardiaca`, `altura_uterina`, ...)

---

### Pregnancy Events (eventos da gestação)

Todas as rotas exigem `Authorization: Bearer <token>`.
Criação e atualização são permitidas para `medico` vinculado ou `admin`; consulta também permite a própria `gestante`.

- Criar: POST `/api/pregnancyEvents`
  - JSON: `{ "pregnancy_id": <id>, "descricao": "...", "data_evento": "YYYY-MM-DD" }`
- Listar por gravidez: GET `/api/pregnancyEvents?pregnancy_id=<id>`
- Atualizar: PUT `/api/pregnancyEvents/:id`

Exemplo de criação:

```bash
curl -X POST http://localhost:3000/api/pregnancyEvents \
  -H "Content-Type: application/json" \
  -d '{"pregnancy_id":2,"descricao":"Ultrassom","data_evento":"2025-03-01"}'
```

---

### Documents (documentos da gestante)

Todas as rotas exigem `Authorization: Bearer <token>`. Gestantes acessam apenas os
próprios documentos; médicos só acessam documentos de gestantes vinculadas em
`doctor_patient_links`; alterações e reprocessamento ficam restritos a médicos e admins.

- Upload (multipart): POST `/api/documents`
  - Form fields: `pregnant_id` (number), `exam_request_id` (number), `document_name` (string), `document_type` (string), `file` ou `document` (arquivo)
  - Para gestante, `exam_request_id` é obrigatório e deve estar pendente para a própria gestação.

Exemplo:

```bash
curl -X POST http://localhost:3000/api/documents \
  -H "Authorization: Bearer SEU_TOKEN" \
  -F "pregnant_id=4" \
  -F "document_name=Ultrassom Inicial" \
  -F "document_type=pdf" \
  -F "file=@/caminho/para/arquivo.pdf"
```

- Listar por `pregnant_id`: GET `/api/documents?pregnant_id=<id>`
- Consultar por id: GET `/api/documents/:id`
- Baixar arquivo: GET `/api/documents/:id/download`
- Consultar texto extraído: GET `/api/documents/:id/text`
  - Retorna `200 OK` com `extraction_status`, `extracted_text`, `extraction_method` e metadados quando `extraction_status = done`.
  - Retorna `202 Accepted` com o status atual enquanto o processamento ainda não terminou.
- Reprocessar extração: POST `/api/documents/:id/extract`
  - Enfileira o documento novamente para extração assíncrona.
- Atualizar metadados: PUT `/api/documents/:id` (JSON com `document_name` e/ou `document_type`)
- Deletar: DELETE `/api/documents/:id`

### Devolutiva médica versionada (E2-05)

O médico com vínculo ativo cria uma versão em revisão e a publica em uma ação
separada. A gestante só enxerga a versão publicada mais recente; versões
anteriores permanecem no histórico como `replaced` e não são editadas ou
apagadas.

- Listar: GET `/api/document-reports/documents/:documentId`
  - médico: histórico completo;
  - gestante: somente a versão publicada mais recente; a abertura é auditada.
- Criar em revisão: POST `/api/document-reports/documents/:documentId`
  - JSON: `{ "severity": "normal|attention|see_consultation|seek_care_today", "content": "..." }`
- Publicar: POST `/api/document-reports/:reportId/publish`

Os textos de `attention` e `see_consultation` devem incluir:
“Esta orientação não é diagnóstico nem prescrição. Procure seu serviço de
saúde conforme orientação do médico.” Para `seek_care_today`, use:
“Seu exame precisa de avaliação hoje. Procure a maternidade.”

Para habilitar as colunas de extração em um banco existente, aplique:

```bash
psql -U myuser -d mydatabase -f apps/api/db/migration_extracted_text.sql
```

O backend inicia o worker assíncrono no boot: executa um ciclo imediatamente e repete a cada 30 segundos, processando até 5 documentos `pending` por ciclo. No upload, a API dispara uma tentativa assíncrona imediata sem bloquear a resposta HTTP. Ajuste `DOCUMENT_EXTRACTION_INTERVAL_MS` e `DOCUMENT_EXTRACTION_BATCH_SIZE` quando necessário; falhas de um ciclo são registradas e não impedem os ciclos seguintes.

### Solicitações de exames

As solicitações feitas pelo médico ficam separadas dos arquivos enviados e dos laudos.
O médico precisa ter vínculo ativo com a gestante:

- `POST /api/exam-requests` — cria uma solicitação (`pregnant_id`, `exam_name` e `instructions` opcional).
- `GET /api/exam-requests/pregnant/:id` — lista as solicitações do paciente; a autorização é validada pelo papel e pelo vínculo.
- `DELETE /api/exam-requests/:id` — cancela uma solicitação ainda `pending`, preservando o histórico.

Os estados previstos são `pending`, `submitted`, `reviewed` e `cancelled`. O upload da E2-02 poderá referenciar a solicitação e avançar seu estado sem transformar o arquivo em uma solicitação.

Na E2-02, a gestante envia PDF ou imagem em `POST /api/documents` usando multipart
com `exam_request_id`, `document_name`, `document_type` e o campo `document` (ou
`file`). O backend confirma que o pedido pertence à gestante autenticada, criptografa
o arquivo em repouso e muda o pedido de `pending` para `submitted` na mesma transação.
Pedidos cancelados ou já enviados não aceitam outro arquivo.

---

### Medições fetais (medicoes)

Exige `Authorization: Bearer <token>` de usuário `medico` ou `admin`.

- Endpoint: POST `/api/medicoes`
  - JSON: `{ "idade_gestacional_semanas": <number>, "comp_femur_mm": <number> }`
  - A rota calcula `comp_fetal_estimado_cm = 6.18 + 0.59 * comp_femur_mm` e insere o registro na tabela `medidas_fetais`.

Exemplo:

```bash
curl -X POST http://localhost:3000/api/medicoes \
  -H "Content-Type: application/json" \
  -d '{"idade_gestacional_semanas":12,"comp_femur_mm":22}'
```

Resposta esperada: `201 Created` com mensagem e objeto da medição.

---

### Histórico clínico (biometria fetal e peso materno)

Todas as rotas exigem `Authorization: Bearer <token>`. Gestante, médico
vinculado e admin podem consultar. Apenas médico vinculado e admin podem
registrar dados.

- `GET /api/history/pregnancies/:pregnancyId`
- `GET /api/history/pregnancies/:pregnancyId/fetal-biometries`
- `POST /api/history/pregnancies/:pregnancyId/fetal-biometries`
- `GET /api/history/pregnancies/:pregnancyId/maternal-weights`
- `POST /api/history/pregnancies/:pregnancyId/maternal-weights`

As consultas aceitam `from`, `to` (`YYYY-MM-DD`), `order` (`asc|desc`) e
`limit` (1 a 500).

Payload de biometria fetal:

```json
{
  "measured_at": "2026-06-15",
  "gestational_age_weeks": 32,
  "dbp_mm": 82,
  "cc_mm": 300,
  "ca_mm": 280,
  "cf_mm": 62,
  "notes": "Ultrassom de rotina"
}
```

O backend calcula e persiste automaticamente PFE, peso mediano esperado,
percentil Hadlock e Z-score.

Payload de peso materno:

```json
{
  "measured_at": "2026-06-15",
  "weight_kg": 68.4,
  "notes": "Consulta pre-natal"
}
```

Em bancos existentes, aplique:

```bash
psql -U myuser -d mydatabase -f apps/api/db/migration_sprint6_history.sql
```

### Consultas clínicas (E6-01.1)

Os registros de consulta são acessíveis somente por médico com vínculo ativo
com a gestante ou por administrador em procedimento operacional auditado. A
gestante não acessa esse registro nesta versão. O campo de prescrição é apenas
texto registrado pelo médico; não é prescrição eletrônica assinada.

- `POST /api/consultations/pregnancies/:pregnancyId` — cria rascunho com `consultation_at`, `evolution` e `conduct`; aceita `gestational_age_weeks`, `prescription_text` e `next_return_at`.
- `GET /api/consultations/pregnancies/:pregnancyId` — lista as versões da gestação.
- `GET /api/consultations/:id` — consulta uma versão.
- `POST /api/consultations/:id/finalize` — finaliza explicitamente o rascunho.
- `POST /api/consultations/:id/addenda` — cria nova versão sem apagar o registro original.

Para acesso administrativo, envie `x-admin-access-reason` com o motivo
operacional. O motivo é gravado na trilha de auditoria. Não há `PUT` ou
`DELETE`: correções após o registro são feitas por adendo, preservando o
histórico.

### Snapshot autorizado do relatório (E5-04.1)

A gestante autenticada pode gerar o snapshot somente da própria gestação:

- `GET /api/reports/pregnancies/:pregnancyId/snapshot`
- `GET /api/reports/pregnancies/:pregnancyId/pdf`
- `POST /api/reports/pregnancies/:pregnancyId/share` — registra `SUCCESS` ou `FAILURE` do share sheet, sem destinatário ou conteúdo.

O snapshot é interno e não é um documento oficial. Ele congela o instante de
geração (`generated_at`) e informa o fuso usado (`timezone`). Inclui apenas:

- exames revisados, com status `accepted` ou `corrected`;
- diário dos últimos 30 dias civis, conforme a data local do fuso informado;
- vacinas com campos preenchidos;
- alertas com status `open` ou `acknowledged`, mantendo o estado explícito.

Se uma seção não tiver dados, ela retorna `status: "not_informed"` e uma lista
vazia. O endpoint não expõe conteúdo de outra gestante, não publica URL e usa
`Cache-Control: no-store`.

O endpoint `/pdf` gera o arquivo no backend e devolve `application/pdf` como
anexo temporário protegido pela mesma autenticação. Não cria URL pública nem
mantém o arquivo disponível depois da resposta; o cliente deve guardar a cópia
somente em área temporária e removê-la após o uso.

O app abre o share sheet do sistema e usa `POST /api/reports/pregnancies/:pregnancyId/share`
apenas para registrar o resultado da operação (`SUCCESS` ou `FAILURE`).
O sistema não envia automaticamente por WhatsApp, e-mail ou outro canal, e a
auditoria não guarda destinatário, token nem conteúdo clínico.

### Doctor Patient Links (vínculo médico-gestante)

Exige `Authorization: Bearer <token>` de usuário `medico`. É esse vínculo que controla quais
gestantes aparecem em `GET /api/pregnants` para o médico e o acesso aos dados clínicos dela
(`utils/clinicalAccess.js`).

- Buscar gestante por email: GET `/api/doctor-patient-links/search?email=<email>`
- Criar/reativar vínculo: POST `/api/doctor-patient-links`
  - JSON: `{ "pregnant_id": <number> }`
- Desativar vínculo: DELETE `/api/doctor-patient-links/:pregnantId`

Exemplo:

```bash
curl "http://localhost:3000/api/doctor-patient-links/search?email=paciente@exemplo.com" \
  -H "Authorization: Bearer <token>"

curl -X POST http://localhost:3000/api/doctor-patient-links \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"pregnant_id":3}'
```

---

### Sync (sincronização)

Exige `Authorization: Bearer <token>` de usuário `admin`.

- Endpoint: POST `/api/sync`
- Payload (exemplo simples):

```json
{
  "last_sync_timestamp": null,
  "changes": {
    "pregnants": {
      "created": [ /* registros criados no cliente */ ],
      "updated": [ /* registros atualizados no cliente */ ]
    }
  }
}
```

- Resposta: JSON com `new_sync_timestamp` e `server_changes` (registros que mudaram no servidor desde `last_sync_timestamp`).

Exemplo de curl:

```bash
curl -X POST http://localhost:3000/api/sync \
  -H "Content-Type: application/json" \
  -d '{"last_sync_timestamp":null, "changes":{}}'
```

---

## Testes automatizados locais

- Existe um script de teste rápido em `apps/api/test_api.sh` que cria dados de exemplo, testa os endpoints principais e faz um resumo OK/FAIL.

Executar:

```bash
cd apps/api
bash test_api.sh
```

Ele depende do backend rodando em `http://localhost:3000` (padrão do docker compose).

---

## Dicas de depuração

- Se um endpoint retornar erro 500, verifique os logs do container backend:

```bash
docker compose logs -f backend
```

- Para aplicar alterações de código locais sem rebuild de imagem (dev): o `docker-compose.yml` monta `./apps/api:/app`, então reiniciar o container recarrega o código:

```bash
docker compose restart backend
```

---

Arquivo de referência do projeto:
- Script de teste: `apps/api/test_api.sh`
- Controllers: `apps/api/controllers/` (ver implementação das rotas)
- Esquema do banco: `apps/api/db/create_tables.sql`

## Setup local

### Gerar dataset de teste (PDFs escaneados)
```bash
node scripts/generate_dataset.js --with-ocr
```

### Baixar guidelines clínicos
```bash
# Criar a pasta e baixar manualmente os PDFs de:
# - FEBRASGO: https://...
# - ACOG: https://...
# - Manual MS: https://...
mkdir -p apps/api/data/guidelines/
```

Se os PDFs das guidelines forem de uso interno ou já tiverem URL fixa, você pode criar um script `scripts/download_guidelines.sh` que faz o download automaticamente — aí o setup fica com um único comando.
