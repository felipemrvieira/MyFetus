# Modelo de dados — ER textual v3

Este inventário é derivado dos arquivos SQL em `apps/api/db` e deve ser lido
junto com as migrations, que são a fonte executável do schema. A relação abaixo
descreve entidades, chaves e ciclo de vida; nomes de campos sensíveis não são
reproduzidos quando a sua semântica é apenas um envelope cifrado.

## Entidades

| Entidade | Chave | Relações e finalidade |
| --- | --- | --- |
| `users` | `id` | Identidade, credenciais com hash, papel e estado. É referenciada por médicos, gestantes, autores, revisores e auditoria. |
| `doctors` | `id`, `user_id` | Perfil profissional do usuário médico: CRM, UF, especialidade e telefone. |
| `pregnants` | `id`, `user_id` | Perfil da gestante e dados obstétricos/antecedentes; pertence a um usuário. |
| `pregnancies` | `id`, `pregnant_id` | Uma gestação da gestante, com DUM/DPP, idade gestacional e dados clínicos básicos. |
| `pregnancy_events` | `id`, `pregnancy_id` | Eventos datados de uma gestação. |
| `medidas_fetais` | `id` | Catálogo/medidas fetais por idade gestacional usado nos cálculos de crescimento. |
| `fetal_biometry_history` | `id`, `pregnancy_id` | Série histórica de biometria, percentil e z-score; autor pode ser removido sem apagar o registro. |
| `maternal_weight_history` | `id`, `pregnancy_id` | Série histórica de peso; pode apontar para a chave/versionamento de uma entrada diária. |
| `doctor_patient_links` | `id`, `(doctor_id,pregnant_id)` | Vínculo único médico–gestante com status `active`/`inactive`. |
| `pregnant_documents` | `id`, `pregnant_id` | Metadados e caminho do documento cifrado, status/método de extração e, opcionalmente, pedido de exame. |
| `exam_requests` | `id`, `pregnant_id`, `doctor_id` | Pedido médico de exame com status `pending`, `submitted`, `reviewed` ou `cancelled`. |
| `loinc_codes` | `id`, `loinc` | Catálogo de código, termo canônico, aliases, categoria, espécime e unidade. |
| `lab_results` | `id`, `document_id`, `pregnant_id` | Linha laboratorial extraída; mantém valor original, valor vigente, status e versão. |
| `lab_result_reviews` | `id`, `lab_result_id`, `version` | Histórico append-only de aceite, correção, rejeição ou reabertura do resultado. |
| `document_reports` | `id`, `document_id`, `pregnant_id`, `version` | Devolutiva médica versionada, com severidade e status `in_review`, `published` ou `replaced`. |
| `consultations` | `id`, `pregnancy_id`, `author_user_id` | Consulta médica; `parent_consultation_id` cria cadeia de adendos. |
| `daily_entries` | `id`, `entry_key`, `pregnant_id`, `pregnancy_id`, `version` | Diário versionado; apenas uma versão corrente por `entry_key`. Campos clínicos são envelopes cifrados. |
| `alert_events` | `id`, `alert_key`, `pregnancy_id`, `pregnant_id` | Alerta de risco deduplicado por chave, com severidade, origem, sinais e estado. |
| `alert_event_history` | `id`, `alert_event_id` | Histórico de reconhecimento/encerramento e justificativa do ator. |
| `device_push_tokens` | `id`, `user_id`, `token_hash` | Token de dispositivo cifrado, hash único, plataforma, habilitação e revogação. |
| `consents` | `id`, `user_id` | Decisões versionadas de consentimento; sem FK deliberada para não impedir exclusão da conta. |
| `audit_logs` | `id` | Auditoria de ações, resultado e recurso; regras impedem update/delete normal. |
| `schema_migrations` | `version` | Controle do executor de migrations, com instante de aplicação. |

## Relacionamentos principais

```text
users 1──0..1 doctors
users 1──0..1 pregnants
users 1──N consents / audit_logs / device_push_tokens
users N──N pregnants        (doctor_patient_links)
pregnants 1──N pregnancies 1──N pregnancy_events
pregnancies 1──N fetal_biometry_history / maternal_weight_history / consultations
pregnants 1──N pregnant_documents 1──N lab_results 1──N lab_result_reviews
exam_requests 1──N pregnant_documents (associação opcional)
pregnant_documents 1──N document_reports
pregnancies/pregnants 1──N daily_entries
pregnancies/pregnants 1──N alert_events 1──N alert_event_history
```

## Regras de integridade e exclusão

- vínculos, gestações, eventos, documentos, resultados e alertas usam cascata
  quando o agregado clínico precisa ser removido;
- autores, revisores e atores de auditoria usam `SET NULL` ou `RESTRICT` quando
  a trilha histórica precisa sobreviver;
- `daily_entries`, `consultations`, `document_reports` e `lab_results` preservam
  versão/status em vez de sobrescrever silenciosamente o histórico;
- `consents` e `audit_logs` são protegidos contra alteração normal;
- campos clínicos marcados pelas migrations como `TEXT` recebem proteção da
  camada AES da aplicação e a versão da chave fica registrada;
- índices de status/data sustentam dashboards e consultas por gestante sem
  alterar o significado clínico dos dados.

## Ordem de aplicação

O executor aplica, em transação e sob advisory lock, `create_tables`, triggers,
migrations gerais, histórico, vínculos, extração, baseline de segurança,
criptografia, segurança de documentos, auditoria, normalização, consentimentos,
pedidos de exame, anexos, aprovação médica, diário, alertas, resultados,
tokens, métricas, histórico de alertas, temperatura, consultas e devolutivas.
Consulte a lista versionada em `apps/api/scripts/migrate.js`; o nome da tabela
`schema_migrations` é a evidência do que já foi aplicado em cada ambiente.
