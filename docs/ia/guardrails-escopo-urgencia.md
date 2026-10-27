# Guardrails de escopo e urgência

O classificador técnico está em `apps/api/services/agents/guardrailService.js` e
usa o contrato versionado `apps/api/data/guardrails.json`.

## Precedência

1. **Urgente:** interrompe retrieval/generation e orienta avaliação presencial.
2. **Prompt injection:** bloqueia a geração e não expõe instruções, tokens ou regras internas.
3. **Fora do escopo:** bloqueia diagnóstico, prescrição, dosagem e temas não relacionados à educação pré-natal.
4. **Dentro do escopo:** permite retrieval e geração controlada.
5. **Clarificação:** bloqueia quando a pergunta é curta ou não contém tema suficiente.

O classificador é executado antes de chamar agentes ou provedor de IA. A categoria,
decisão, razão e versão do contrato seguem no estado interno do fluxo para facilitar
auditoria sem registrar a pergunta integral.

## Limites ainda pendentes do PO

O contrato não presume texto clínico definitivo, serviço local de emergência,
idiomas, tom ou lista final de temas. Esses pontos permanecem explicitamente
marcados no JSON e devem ser aprovados antes de considerar o guardrail homologado.
