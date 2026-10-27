# E7-04.2 — evidências e pendências residuais da DPIA

Esta matriz atualiza a #216 sem reabrir as decisões já registradas na DPIA. O objetivo é separar o que já tem evidência técnica do que ainda precisa de responsável, prazo, validação operacional ou decisão jurídica.

## Controles que avançaram nesta entrega

| Controle | Evidência técnica | Estado |
| --- | --- | --- |
| R06 — chave AES obrigatória | `config/runtimeRequirements.js` valida a chave versionada antes do boot em `production`; `runtimeRequirements.test.js` cobre ausência e chave válida. | Implementado tecnicamente; falta comprovar a configuração real de homologação/produção. |
| R14 — menores de 18 anos | `utils/agePolicy.js` valida data civil e idade mínima; cadastro de gestante e médico rejeita idade abaixo de 18 anos. | Implementado tecnicamente; falta teste integrado do endpoint com banco/homologação. |
| R01/R02/R04 — uso seguro de IA | Guardrails, fallback sem fonte e proteção contra prompt injection estão na `main` pelos PRs #227 e #228. | Implementação técnica existente; falta validar o desligamento para contas reais e o critério de conta sintética. |
| R03/R08/R13/R18 | Fluxos de aprovação, consentimento, exportação e exclusão possuem PRs/testes já mergeados. | Evidência parcial; falta demonstrar o fluxo completo e anexar evidência de ambiente. |

## Pendências que continuam no card

### Governança e operação

- indicar responsável e substituto de Segurança;
- indicar responsável e substituto de Infraestrutura;
- registrar o substituto do PO;
- definir o prazo de expiração de backups;
- definir o critério técnico verificável para contas sintéticas;
- validar juridicamente o prazo e o canal de comunicação de incidentes;
- indicar onde ficarão as evidências de homologação e quem fará a conferência.

### Controles técnicos ainda sem evidência suficiente

- R03: demonstrar que o vínculo médico–gestante exige consentimento vigente, não apenas aprovação do médico;
- R08: executar teste integrado de consentimento vigente no acesso clínico;
- R10: comprovar limpeza de temporários, limites, tipos permitidos e descarte de órfãos;
- R11/R12: medir os registros legados em cada ambiente e concluir a proteção dos históricos fora da classificação AES;
- R13/R18: comprovar remoção/anonimização de arquivos, backups, vetores derivados e auditoria;
- R01/R02/R04: verificar em ambiente real que contas não sintéticas não acessam o chat, e que logs/métricas não contêm PII;
- R15/R16/R17/R19/R20: anexar evidências específicas de cada controle e registrar exceções.

## Critério para fechar

O card não deve ir para `Done` somente porque o código existe. Para cada risco, o card precisa apontar: responsável, prazo, ambiente verificado, teste/evidência e decisão residual. Riscos altos continuam bloqueando o teste real conforme a decisão do PO.
