# E4-10 — controle de custo e uso das rotas de IA

Foi adicionada uma baseline técnica para as rotas de busca, chat e análise materna.

## O que já existe

- rate limit específico de IA, preservando os limites atuais quando `AI_RATE_LIMIT_MAX` não está configurado;
- cota diária por usuário, ativada somente quando `AI_DAILY_QUOTA` é definido;
- cache em memória com chave hash que inclui usuário, papel, rota, operação, versão do prompt, versão do manifesto e payload;
- cache desativado por padrão (`AI_CACHE_TTL_MS` ausente/zero);
- respostas com contexto de paciente não entram no cache por padrão;
- limite de entradas e TTL configuráveis;
- métricas em memória de requisições, cache hit/miss, bloqueios, erros, latência e tokens informados pelo provedor;
- métricas não armazenam pergunta, resposta, identificadores de paciente ou texto clínico.

## Pendências do PO/Operação

Os valores abaixo não foram inventados no código e precisam ser definidos antes de considerar o controle operacional concluído:

- cota diária por perfil (`gestante`, `medico`, `admin`) e se existe exceção autorizada;
- janela e limite de rate limit por operação;
- TTL, invalidação e autorização para cache de respostas personalizadas;
- orçamento diário/mensal de Gemini e Pinecone;
- destino persistente das métricas (logs estruturados, banco ou serviço externo), retenção e acesso;
- comportamento esperado quando a cota, o provedor ou o armazenamento de métricas estiver indisponível;
- store distribuído para múltiplas réplicas; o cache e a cota atuais são locais ao processo e não são suficientes para produção horizontalizada.

Até essas decisões, a implementação serve como contrato técnico testável, com cache e cota desligados por padrão e sem alteração silenciosa dos limites atuais.
