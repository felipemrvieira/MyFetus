# Embeddings e Upsert Idempotente com Retry e Resume no RAG

Decidimos que o pipeline de ingestão vetorial do RAG (E4-02.3) deve garantir idempotência estrita via upsert por ID canônico determinístico, envio em lotes de até 100 vetores (`RAG_UPSERT_BATCH_SIZE`), resiliência a falhas de rede com política de retry com exponential backoff (3 tentativas) e persistência incremental de checkpoints em `.rag-checkpoint.json` para suportar resume imediato de execuções interrompidas.

Essa estratégia foi escolhida em vez de regravação total a cada execução porque os manuais clínicos aprovados são volumosos e demandam custo computacional significativo de extração e vetorização na CPU. O checkpoint local por documento (vinculado ao SHA-256) permite que falhas transitórias de conexão com o Pinecone não descartem o progresso já conquistado, e o batching previne saturação de memória e rejeição de payloads por limites da API externa.
