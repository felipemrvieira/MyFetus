# Consentimento LGPD no cadastro (E7-01.1)

Issue: #143 (subtask da #56). **Status: rascunho.** O texto do termo e as regras abaixo
aguardam aprovação do P.O./orientação jurídica. A issue só fecha após essa aprovação.

## O que foi implementado

- **Cadastro exige aceite.** `POST /api/users` só cria a conta se o corpo trouxer `consents`
  com todas as finalidades obrigatórias na **versão vigente**. Sem aceite → `400 CONSENT_REQUIRED`;
  versão antiga → `409 CONSENT_VERSION_OUTDATED`. Usuário e consentimento são gravados na mesma
  transação: se um falha, nenhum dos dois fica no banco.
- **Registro versionado e auditável.** Tabela `consents` (`user_id`, `purpose`, `version`,
  `decision`, `ip_address`, `user_agent`, `created_at`), migration `12_consents.sql`.
  Cada decisão também gera evento na auditoria (`CONSENT_ACCEPTED`, `CONSENT_REFUSED`,
  `CONSENT_REVOKED`).
- **Revogação sem apagar a trilha.** A tabela é append-only (o banco ignora `UPDATE` e `DELETE`,
  como em `audit_logs`). O estado de uma finalidade é o registro mais recente; revogar acrescenta
  uma linha e preserva o aceite anterior.
- **Nova versão exige novo aceite.** A versão vigente fica em `apps/api/config/consentPolicy.js`.
  Ao mudá-la, aceites anteriores passam a `outdated`, e o login devolve
  `consent: { required: true, pending: [...] }`.
- **App mobile.** O cadastro carrega o termo de `GET /api/consents/policy`, exige o checkbox de
  aceite, permite ler o texto e trata a troca de versão durante o preenchimento.
- **Seeds.** As gestantes sintéticas recebem o aceite da versão vigente (idempotente).

## Endpoints

| Método | Rota | Acesso | Uso |
|---|---|---|---|
| `GET` | `/api/consents/policy` | Público | Finalidades, versões vigentes e texto do termo. |
| `GET` | `/api/consents/me` | JWT | Status do usuário autenticado por finalidade. |
| `POST` | `/api/consents` | JWT | `{ purpose, decision: accepted\|refused\|revoked, version }` do próprio usuário. |

O titular é sempre o usuário do token: não existe ID de usuário no corpo (sem risco de IDOR).
Contrato completo em `apps/api/openapi.yaml` (`/docs`).

## Como publicar uma nova versão do termo

1. Atualizar `text` e `version` da finalidade em `apps/api/config/consentPolicy.js`.
2. Registrar a mudança no PR (o que mudou e quem aprovou).
3. A partir do deploy, novos cadastros exigem a nova versão e o login de quem aceitou a anterior
   passa a sinalizar `consent.required: true`.

## Decisões pendentes do P.O./orientação jurídica

| Decisão | Situação atual (provisória) |
|---|---|
| Texto e versão do termo de uso e da política de privacidade | Rascunho `0.1-rascunho`, baseado no que o sistema faz hoje. |
| Finalidades que exigem aceite separado (ex.: pesquisa, IA) | Uma finalidade obrigatória: `termos_e_privacidade`. |
| Médicos e administradores precisam consentir? | Apenas gestantes (`CONSENT_REQUIRED_ROLES`). |
| Momento do bloqueio para contas existentes | O login **informa** a pendência; a API ainda **não bloqueia** as demais rotas. |
| Efeitos da recusa e da revogação | Ficam registradas e o termo volta a pendente; sem bloqueio de uso por enquanto. |
| Regras de novo aceite | Toda mudança de `version` exige novo aceite. |
| Base legal por finalidade | Não definida (o documento do ciclo indica validar com a orientação jurídica da UPE). |
| Retenção dos registros de consentimento | Mantidos sem chave estrangeira para `users` (prova do consentimento, LGPD art. 8º, §2º); prazo a definir na E7-02. |

## Fora deste PR

- Telas no app para novo aceite (versão nova) e revogação; a API já suporta ambos.
- Bloqueio das rotas para quem tem termo pendente, recusado ou revogado (depende das decisões acima).
- Exportação e exclusão de dados do titular (E7-02, #145).
