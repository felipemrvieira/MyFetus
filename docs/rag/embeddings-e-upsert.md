# Embeddings e Upsert Idempotente do RAG

| Campo | Valor |
| --- | --- |
| Issue | E4-02.3 — Embeddings e upsert idempotente (subtask da #127) |
| Depende de | E4-02.1 — Gate do manifesto ([`docs/rag/gate-do-manifesto.md`](./gate-do-manifesto.md)), E4-02.2 — Extração e chunking ([`docs/rag/extracao-e-chunking.md`](./extracao-e-chunking.md)) |
| Código principal | `apps/api/services/embeddingService.js`, `apps/api/services/vectorStoreService.js`, `apps/api/services/ragIngestionService.js` |
| Testes | `apps/api/tests/embeddingService.test.js`, `apps/api/tests/vectorStoreService.test.js`, `apps/api/tests/ragIngestionService.test.js` |
| ADR | [`docs/adr/0005-rag-idempotent-upsert-and-embeddings.md`](../adr/0005-rag-idempotent-upsert-and-embeddings.md) |

---

## 1. Visão Geral

Esta especificação define o funcionamento da geração de representações vetoriais densas (*embeddings*) e o envio idempotente de vetores ao Pinecone para o sistema RAG do MyFetus 3.0.

### Princípios Fundamentais
1. **Idempotência Estrita**: Reexecuções do comando de ingestão com o mesmo acervo mantêm contagens de vetores no índice rigorosamente estáveis.
2. **Configurabilidade Centralizada**: Modelo, dimensão, namespace e tamanho de lote são configuráveis via variáveis de ambiente com validação prévia de compatibilidade.
3. **Resiliência e Resume**: O pipeline suporta checkpoints de conclusão por documento (`apps/api/data/.rag-checkpoint.json`). Falhas em documentos intermediários permitem retomar o processamento sem recalcular documentos já concluídos.
4. **Retry Exponencial com Jitter**: Chamadas de rede para a API do Pinecone realizam até 3 tentativas com backoff exponencial para mitigar falhas transitórias.
5. **Privacidade e Sanitização de Logs**: Todo log estruturado suprime o texto clínico integral dos chunks (`chunk.text`) e expurga chaves ou tokens em stacktraces de erro.

---

## 2. Configurações de Ambiente

| Variável | Padrão | Descrição |
| --- | --- | --- |
| `RAG_EMBEDDING_MODEL` (ou `EMBEDDING_MODEL`) | `Xenova/multilingual-e5-small` | Modelo Hugging Face utilizado para extração de features |
| `RAG_EMBEDDING_DIMENSION` (ou `EMBEDDING_DIMENSION`) | `384` | Dimensão vetorial esperada |
| `PINECONE_INDEX_NAME` | `myfetus-rag` | Nome do índice no Pinecone |
| `PINECONE_NAMESPACE` | `guidelines` | Namespace lógico isolado no índice |
| `RAG_UPSERT_BATCH_SIZE` | `100` | Quantidade máxima de vetores por chamada HTTP ao Pinecone |
| `PINECONE_MOCK` | `false` | Quando `true` ou em ausência de chave em testes, usa store em memória |

---

## 3. Fluxo de Ingestão e Resume

```
[PDF Aprovado] 
      │
      ▼
[Extração & Chunks Determinísticos]
      │
      ▼
[Verificação do Checkpoint]
      ├── Se já indexado com mesmo SHA-256 (e force !== true) ──► Pula documento
      └── Se não indexado ou force === true
               │
               ▼
       [Geração de Embeddings] (Xenova E5 / normalização L2)
               │
               ▼
       [Batching de Upsert] (Até 100 vetores com retry e backoff)
               │
               ▼
       [Gravação Incremental no Checkpoint] (documentId, sha256, vectorCount)
```

---

## 4. Estrutura do Checkpoint

Localização: `apps/api/data/.rag-checkpoint.json` (ignorado pelo Git).

```json
{
  "documents": {
    "caderneta-gestante-ms-2026": {
      "sha256": "068bb50763c549fdd7a4bf55f36653b5b8c763369e049d4d44c620db656db980",
      "completedAt": "2026-10-26T19:40:00.000Z",
      "vectorCount": 142
    }
  }
}
```

---

## 5. Como Executar

- Ingestão padrão (com suporte a resume):
  ```bash
  cd apps/api
  npm run rag:ingest
  ```
- Execução forçada (reprocessa mesmo com checkpoint existente):
  ```bash
  RAG_FORCE_INGEST=true npm run rag:ingest
  ```
- Testes automatizados no CI:
  ```bash
  npm run test:ci
  ```
