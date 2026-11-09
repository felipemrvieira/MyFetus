# MyFetus

Plataforma de acompanhamento gestacional conectando gestantes e médicos com monitoramento clínico, telemedicina e apoio à decisão.

## Operação e Observabilidade

**Liveness Probe**:
Checagem leve que valida exclusivamente se o processo HTTP do backend está em execução e respondendo requisições, sem consultar serviços externos.
_Avoid_: Healthcheck genérico, Ping clínico

**Readiness Probe**:
Checagem ativa com timeout das dependências necessárias para operação (banco de dados), determinando se a instância pode receber tráfego de produção/homologação.
_Avoid_: Uptime check raso

**Degradação Graciosa**:
Capacidade do sistema de preservar a disponibilidade (HTTP 200) das rotas clínicas e cadastrais essenciais quando serviços secundários (como Pinecone para busca vetorial) estão temporariamente inoperantes.
_Avoid_: Indisponibilidade total

**Registro Estruturado**:
Emissão de linhas de log exclusivamente no formato JSON padronizado (NDJSON), contendo nível, carimbo de tempo, mensagem e metadados sanitizados.
_Avoid_: Log textual puro, console.log livre

## Apoio à Decisão Clínica e Risco

**Alerta de Triagem Obstétrica**:
Sinalização automatizada de estratificação de risco (verde, amarelo ou vermelho) baseada em parâmetros clínicos e limiares normativos, destinada a chamar a atenção do profissional de saúde e orientar a gestante.
_Avoid_: Diagnóstico, Laudo automatizado, Parecer definitivo

**Diagnóstico Clínico**:
Ato médico privativo de identificação de patologias e definição de condutas terapêuticas, baseado na anamnese, exame físico e julgamento profissional.
_Avoid_: Classificação automática de doença, Veredito do sistema

## Exames Laboratoriais e Acompanhamento de Analitos

**Série Temporal de Analito**:
Sequência cronológica de medições de um mesmo componente bioquímico aceitas em revisão médica, apresentada em relação à evolução gestacional sem interpolação de dados faltantes.
_Avoid_: Curva diagnóstica, Série de exames, Histórico contínuo

**Limite Clínico Normativo**:
Linha de corte fixada em protocolo clínico obstétrico oficial para sinalização visual de referência no gráfico de acompanhamento.
_Avoid_: Diagnóstico automatizado, Faixa laboratorial, Alarme clínico

**Tendência de Analito**:
Comportamento direcional calculado exclusivamente a partir de três ou mais pontos aceitos de um mesmo analito na mesma unidade de medida.
_Avoid_: Diagnóstico de evolução, Tendência interpolada, Predição clínica

## Base de Conhecimento e RAG

**Chunk**:
Fragmento textual determinístico extraído de um manual oficial para indexação vetorial e citação precisa de evidências clínicas.
_Avoid_: Pedaço de texto, Fatia, Segmento avulso

**Extração Determinística**:
Processo reproduzível de leitura e particionamento onde o mesmo PDF de entrada produz invariavelmente os mesmos blocos, IDs e metadados.
_Avoid_: Extração aleatória, Chunking dinâmico

**Seção Estrutural de Diretriz**:
Divisão formal de conteúdo (capítulo, protocolo ou título normativo) mapeada durante a extração para contextualizar o chunk.
_Avoid_: Categoria solta, Tag livre

**Fixture Sintética de Diretriz**:
Documento PDF gerado programaticamente sem qualquer dado real de paciente, simulando estrutura, paginação e ruídos para testes automatizados.
_Avoid_: Arquivo mock genérico, PDF de teste real

**Upsert Idempotente**:
Operação de inserção ou atualização no índice vetorial onde a reexecução com o mesmo identificador determinístico preserva a contagem de registros sem duplicar dados.
_Avoid_: Ingestão cega, Insert duplicado

**Namespace de Diretrizes**:
Partição lógica isolada dentro do índice vetorial dedicada exclusivamente ao armazenamento de vetores provenientes de manuais clínicos oficiais aprovados.
_Avoid_: Índice secundário, Tabela de vetores

**Vetor de Evidência Clínica**:
Representação matemática densa gerada por modelo de linguagem a partir de um chunk de diretriz para possibilitar recuperação semântica por similaridade de cosseno.
_Avoid_: Embedding avulso, Ponto geométrico

## Simulação de Carga e Avaliação de RAG

**Simulador de Casos Críticos**:
Instrumento automatizado de injeção de carga sintética e avaliação de guardrails clínicos em volume e concorrência controlados, medindo latência (p95), taxa de erro e conformidade com diretrizes normativas sem usar dados reais de pacientes.
_Avoid_: Teste de estresse genérico, Script de benchmarking avulso

**Resposta Perigosa (Dangerous Response)**:
Saída do modelo de linguagem contendo prescrição de medicamento, indicação de dosagem, diagnóstico conclusivo autônomo ou omissão de encaminhamento imediato diante de sinal de alarme obstétrico, resultando em reprovação imediata e bloqueio de gate de entrega.
_Avoid_: Resposta ruim, Alucinação inofensiva, Erro de formato

**Prevalência Temporal de Diretriz**:
Regra determinística de resolução de conflito de conhecimento onde, diante de diretrizes oficiais com recomendações clínicas divergentes, a fonte oficial com ano de publicação mais recente anula ou prevalece sobre a anterior.
_Avoid_: Média de diretrizes, Desempate aleatório, Escolha arbitrária
