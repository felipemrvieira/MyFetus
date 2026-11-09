# Revisão médica dos analitos extraídos (E2-04)

Issue: #61. Decisões do P.O. (Dr. Rui) em 29/10/2026, no comentário da #61.
Depende da E2-03 (#59, parser). Libera a E2-07 (#100), a E2-06 (#101) e a E2-05 (#62).

## Fluxo

1. A gestante envia o exame e o worker extrai o texto (`documentExtractionWorker`).
2. Logo depois, o parser (`labResultParser`) lê os analitos e cada um vira uma linha em
   `lab_results` com status `pending`. Documentos extraídos antes desta etapa são
   estruturados na primeira vez que o médico abre a revisão.
3. O médico vinculado abre **Exames → Revisar valores extraídos** e decide linha a linha.
4. Só `accepted` e `corrected` têm uso clínico (prontuário, gráficos e motor de risco).
   O campo `clinically_usable` da API já diz isso.

## Decisões do P.O.

| # | Pergunta | Resposta |
|---|---|---|
| 1 | Quem revisa | Só o médico vinculado. O admin não revisa resultado clínico. |
| 2 | Reabertura | Sim, pelo médico vinculado, com justificativa. Gera nova versão; a anterior fica no histórico. |
| 3 | O que corrige | Valor, unidade, referência, data da coleta e, na glicemia, o tipo do exame (jejum, casual ou TOTG 75 g com o tempo: 0, 1 h ou 2 h). |
| 4 | Rejeição | O resultado fica guardado para auditoria, sem uso clínico. |
| 5 | Justificativa | Aceitar não precisa; corrigir e rejeitar, obrigatória. Na glicemia, aceitar exige o tipo do exame. |
| 6 | Baixa confiança | Pode aceitar, com aviso visível e o trecho original do documento ao lado. |
| 7 | Lote | Fora da v1. |
| 8 | Destinos | Prontuário, gráficos e motor de risco. A gestante só vê o valor pela devolutiva do médico. |
| 9 | Auditoria | Valor original, valor revisado, ação, justificativa, usuário, data/hora e versão. |

## Estados

| Ação | De | Para | Justificativa |
|---|---|---|---|
| Aceitar | `pending` | `accepted` | não |
| Corrigir | `pending` | `corrected` | sim |
| Rejeitar | `pending` | `rejected` | sim |
| Reabrir | `accepted`, `corrected` ou `rejected` | `pending` | sim |

- Toda ação manda a `version` que o médico abriu. Se outra pessoa (ou um clique duplo) já mudou
  a linha, a API responde `409 LAB_RESULT_VERSION_CONFLICT` e o app recarrega a lista.
- Aceitar ou corrigir exige valor, data da coleta e, para valor numérico, a unidade. Na glicemia,
  exige o tipo do exame e, no TOTG, o tempo. Sem isso, `422 LAB_RESULT_INCOMPLETE` com a lista em
  `missing`, e o app sugere usar Corrigir.
- O parser só preenche o tipo da glicemia quando ele está escrito no laudo (jejum, TOTG, casual).
  Antes, uma glicemia sem tipo virava "casual"; agora fica sem tipo e o médico informa.
- "Baixa confiança" é confiança abaixo de 0,9 ou qualquer ambiguidade apontada pelo parser
  (LOINC não confirmado, valor, unidade ou data não encontrados).

## API

Todas as rotas exigem token de médico aprovado e vinculado à gestante (`403` para os demais,
inclusive admin). Contrato completo em `apps/api/openapi.yaml`.

| Método | Rota | O que faz |
|---|---|---|
| GET | `/api/lab-results/documents/:documentId` | Documento, contagem por status e resultados. |
| GET | `/api/lab-results/:id/history` | Versões da revisão, em ordem. |
| POST | `/api/lab-results/:id/accept` | `{ version, exam_type?, timepoint? }` |
| POST | `/api/lab-results/:id/correct` | `{ version, reason, value, unit, reference_low, reference_high, observed_at, exam_type, timepoint }` |
| POST | `/api/lab-results/:id/reject` | `{ version, reason }` |
| POST | `/api/lab-results/:id/reopen` | `{ version, reason }` |

## Banco

Migration `18_lab_results.sql` (`apps/api/db/migration_lab_results.sql`):

- `lab_results`: uma linha por analito do documento (`UNIQUE (document_id, line_index)`).
  `original_*` guarda o que o parser leu e nunca muda; os campos sem prefixo são os vigentes.
  Valores, unidade, referência, data, trecho original e justificativa são cifrados (AES-256-GCM),
  como os demais dados clínicos.
- `lab_result_reviews`: uma linha por decisão (`UNIQUE (lab_result_id, version)`), com o snapshot
  cifrado dos valores e da justificativa. É o histórico pedido no item 9.
- As duas tabelas caem em cascata com o documento e com a gestante (exclusão de conta, E7-02).
  O autor da revisão vira `NULL` se a conta do médico sumir; hoje ela é anonimizada, não apagada.

A auditoria (`audit_logs`) registra `LAB_RESULT_ACCEPTED`, `LAB_RESULT_CORRECTED`,
`LAB_RESULT_REJECTED` e `LAB_RESULT_REOPENED` com o analito, a versão e os status. O valor e a
justificativa ficam só em `lab_result_reviews`, cifrados, para não pôr dado de saúde em claro no log.

Os migradores `scripts/migrate.js` (local) e `apps/api/scripts/migrate.js` (Cloud Run) listam a 18.
O local também passou a listar a 16 (diário) e a 17 (alertas), que só estavam no de Cloud Run.

## Exportação do titular

A exportação "Meus dados" (E7-02) ganhou a seção `resultados_de_exame`, com o valor lido, o valor
vigente e o status da revisão. Ficam de fora o autor e a justificativa, que são registros do médico.

## Testes

- `apps/api/tests/labResults.test.js` (no `test:ci`): estruturação do texto, cada regra de
  transição, cifragem no banco, acesso (médico sem vínculo, admin, gestante, sem token), clique
  duplo, histórico de versões, auditoria sem valor e rollback em falha no meio da decisão.
- `apps/mobile/tests/labReview.test.ts`: formatação, montagem do corpo de cada ação e mensagens
  de erro da tela.

## Fora do escopo

- Ligar os resultados aceitos ao motor de risco e aos alertas: E2-07 (#100).
- Gráfico da série de um analito: E2-06 (#101).
- Mostrar o valor para a gestante: só pela devolutiva do médico, E2-05 (#62).
- Revisão em lote (item 7).
