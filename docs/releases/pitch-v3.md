# Roteiro do pitch de entrega — MyFetus v3.0.0

**Duração alvo:** 3–4 minutos  
**Hospedagem:** YouTube não listado  
**Ambiente:** homologação no build do freeze 23/11  
**Dados:** contas sintéticas; nenhum token, PII ou segredo na tela

Este roteiro prepara a gravação da issue #186. A gravação só deve ser marcada
como evidência depois de executada contra o build do freeze e revisada quadro a
quadro. Se a sessão falhar, registrar a falha em vez de simular o resultado.

## Pré-gravação

- abrir uma sessão limpa do navegador/emulador e desativar notificações;
- usar a conta sintética de gestante e a conta sintética de médico aprovadas
  para a homologação;
- confirmar que a URL exibida é a de homologação e que a revisão corresponde ao
  SHA do freeze;
- conferir que o chat/RAG tem fonte aprovada e citação disponível;
- limpar clipboard, histórico e qualquer painel que possa exibir tokens;
- iniciar a gravação somente após validar `/ping`, `/health` e o fluxo de login.

## Roteiro por tempo

| Tempo | Ação e narração | Evidência do aceite |
| --- | --- | --- |
| 0:00–0:20 | Apresentar o MyFetus como sistema acadêmico de acompanhamento materno-fetal e informar que a demo usa dados sintéticos. | Escopo e segurança contextualizados. |
| 0:20–0:55 | Fazer login como gestante e mostrar a jornada principal, sem revelar credenciais. | Login da gestante. |
| 0:55–1:35 | Abrir o diário, registrar um sinal de alarme e mostrar o retorno da regra. Não narrar o alerta como diagnóstico. | Diário com sinal de alarme. |
| 1:35–2:05 | Trocar para o perfil médico e mostrar o alerta no painel da paciente sintética. | Alerta no painel médico. |
| 2:05–2:45 | Abrir o documento/exame, mostrar o resultado revisado e a devolutiva publicada. | Exame revisado e devolutiva. |
| 2:45–3:25 | Abrir o chat, fazer uma pergunta segura e mostrar a citação retornada e a limitação/guardrail. | Chat com citação. |
| 3:25–3:45 | Encerrar destacando que a versão é de homologação, com limitações e backlog publicados. | Não confundir release acadêmica com produção. |

## Falhas e fallback

- se o alerta não aparecer, interromper a gravação e registrar o incidente; não
  inserir uma tela artificial;
- se o chat/RAG estiver indisponível, mostrar a mensagem de indisponibilidade e
  marcar o critério como pendente, ou usar uma gravação previamente validada
  contra o mesmo SHA;
- se aparecer um token, PII ou URL sensível, descartar a gravação e limpar o
  artefato antes de uma nova sessão;
- se o ambiente estiver fora do SHA do freeze, não publicar o vídeo como release.

## Pós-gravação

- assistir o vídeo inteiro sem acelerar;
- conferir ausência de dados reais, tokens, segredos, notificações e abas extras;
- conferir que a versão/build, ambiente e limitações foram informados;
- publicar como **não listado** no YouTube;
- registrar na issue #186 e na #134 a URL, duração, SHA/revisão e data;
- atualizar o README com o link somente após a revisão e aprovação do PO.
