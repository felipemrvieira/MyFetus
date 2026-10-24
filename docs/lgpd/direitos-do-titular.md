# Direitos do titular: exportação dos dados (E7-02.1)

Issue: #145 (subtask da #69). Decisões do P.O. (Dr. Rui) registradas em 23/10/2026 no comentário da #69.
Prazo do marco: M2 (19/11/2026), junto com a exclusão.

Esta é a **etapa 1**: exportação em JSON pela API. A tela no app e a exclusão/anonimização entram nas
próximas entregas (ver "Próximas etapas").

## Decisões do P.O.

| # | Decisão | Resposta |
|---|---|---|
| 1 | Dados na exportação | Aprovado: só os dados do próprio titular, sem segredos, dados de terceiros e registros internos de segurança. |
| 2 | Formato | Aprovado: JSON agora; PDF legível só se sobrar tempo. |
| 3 | Identidade | Aprovado: usuário autenticado e confirmação da senha antes de exportar ou excluir. |
| 4 | Exclusão ou anonimização | Aprovado: excluir dados pessoais e anonimizar o que precisa ficar por retenção ou auditoria. |
| 5 | Prazo e responsável | Ajustado: até 7 dias; responsável é o Dr. Rui. |
| 6 | Escopo por perfil | Aprovado: gestante exporta os seus dados; médico, os do próprio perfil (não os dos pacientes); administrador, só por procedimento operacional. |

## Endpoint

`POST /api/privacy/export` com `{ "password": "<senha atual>" }` e `Authorization: Bearer <JWT>`.

- O titular é sempre o usuário do token. Não existe ID no corpo nem na URL; um `user_id` enviado é ignorado.
- Senha ausente: `400 PASSWORD_REQUIRED`. Senha incorreta, conta inativa ou usuário inexistente:
  a mesma resposta `401 INVALID_PASSWORD`, para não revelar o estado da conta.
- Resposta `200` em JSON, como anexo (`myfetus-meus-dados-AAAA-MM-DD.json`) e com `Cache-Control: no-store`.
- Limite próprio: 5 pedidos a cada 15 minutos (`DATA_EXPORT_RATE_LIMIT_MAX`).
- Fica fora do bloqueio por consentimento (`middlewares/consent.js`): quem revogou o consentimento
  continua podendo exercer o direito de acesso.
- A leitura é feita numa transação `REPEATABLE READ READ ONLY`, para as seções serem coerentes entre si.

## O que entra, por perfil

| Seção | Gestante | Médico | Admin | Origem |
|---|---|---|---|---|
| `titular` (nome, e-mail, nascimento, papel, datas) | Sim | Sim | Sim | `users` |
| `consentimentos` (finalidade, versão, decisão, data) | Sim | Sim | Sim | `consents` |
| `prontuario` | Sim | | | `pregnants` |
| `gestacoes`, `eventos` | Sim | | | `pregnancies`, `pregnancy_events` |
| `biometria_fetal`, `peso_materno` (sem os apagados logicamente) | Sim | | | históricos da sprint 6 |
| `pedidos_de_exame` | Sim | | | `exam_requests` |
| `documentos` (metadados, laudo e texto extraído) | Sim | | | `pregnant_documents` |
| `vinculos_medicos` (status e datas) | Sim | | | `doctor_patient_links` |
| `perfil_profissional` (CRM, UF, especialidade, telefone) | | Sim | | `doctors` |

As colunas de cada tabela são uma lista explícita em `apps/api/services/dataExportService.js`.
Coluna nova no banco **não** entra na exportação até ser adicionada lá.

## O que fica de fora, e por quê

| Fica de fora | Motivo |
|---|---|
| `password`, `email_lookup_hash` | Segredos (hash bcrypt e HMAC de busca). |
| `encryption_key_version`, `file_encryption_version`, `file_path` | Detalhes internos de segurança e armazenamento. |
| `doctor_id`, `created_by_user_id`, `reviewed_by_user_id` e dados do médico vinculado | Dados de terceiros. |
| `ip_address` e `user_agent` dos consentimentos, `audit_logs` | Registros internos de segurança. |
| Arquivos originais dos exames | O JSON traz metadados e o texto extraído; o download dos arquivos pode entrar depois. |
| `medidas_fetais` | Tabela sem vínculo com usuário (não é dado do titular). |
| Vetores no Pinecone | Guardam só trechos das diretrizes oficiais (resposta 6 da DPIA), sem dado do titular. |

## Auditoria

Cada pedido gera `DATA_EXPORT` em `audit_logs`:

- sucesso: `detail` só com o formato e a contagem de itens por seção, sem conteúdo pessoal;
- falha: `detail.reason` com `invalid_password`, `user_not_found` ou `internal_error`;
- excesso de pedidos: `DATA_EXPORT_BLOCKED`.

## Testes

`apps/api/tests/dataExport.test.js` (no `npm run test:ci`) usa a cifragem AES real com chave de teste e um
banco falso com duas gestantes e uma médica. Cobre: dados decifrados, usuário A sem dados de B, nenhum
segredo/ciphertext/caminho/ID de terceiro, médico sem dados de pacientes, ID no corpo ignorado, senha
ausente e incorreta, conta inativa, sem token, auditoria só com contagens, snapshot somente leitura,
erro 500 genérico e isenção do bloqueio por consentimento.

## Próximas etapas

1. **Tela no app:** "Meus dados" no perfil, com confirmação da senha e compartilhamento do arquivo.
2. **Exclusão/anonimização (#69):** excluir os dados pessoais, anonimizar consentimentos e auditoria (ficam até o
   fim do projeto, resposta 4 da DPIA), remover os arquivos cifrados de `uploads/` e avisar que o backup só é
   limpo quando expira (resposta 5 da DPIA).
3. **Prazo operacional:** registrar no fluxo de atendimento o prazo de até 7 dias com o Dr. Rui como responsável.
4. **PDF:** só se sobrar tempo (decisão 2).
