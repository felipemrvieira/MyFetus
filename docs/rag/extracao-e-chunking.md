# Extração e Chunking Reproduzível do RAG

| Campo | Valor |
| --- | --- |
| Issue | E4-02.2 — Extração e chunking reproduzível (subtask da #127) |
| Depende de | E4-02.1 — Gate do manifesto ([`docs/rag/gate-do-manifesto.md`](./gate-do-manifesto.md)) |
| Código principal | `apps/api/services/pdfTextExtractor.js`, `apps/api/services/chunkingService.js` |
| Testes | `apps/api/tests/chunkingService.test.js`, `apps/api/tests/pdfTextExtractor.test.js` |
| ADR | [`docs/adr/0004-extracao-chunking-deterministico-rag.md`](../adr/0004-extracao-chunking-deterministico-rag.md) |

---

## 1. Visão Geral

Esta especificação define as regras de negócio, contratos de interface e tratamento de erros para a extração de texto e divisão em blocos (*chunks*) determinísticos a partir dos manuais oficiais aprovados pelo manifesto de fontes do MyFetus 3.0.

### Princípios Fundamentais
1. **Determinismo Estrito**: Para o mesmo arquivo de entrada e versão de manifesto, o pipeline gera invariavelmente os mesmos chunks, textos e IDs. Timestamps voláteis (ex.: `indexedAt`) não pertencem aos metadados do chunk gerado.
2. **Rastreabilidade Clínica**: Todo chunk preserva obrigatoriamente `documentId`, `title`, `year`, `page` e `section`.
3. **Fronteira Rígida de Seção**: Mudanças de capítulo ou seção forçam a quebra imediata do chunk corrente. Nenhum chunk mistura conteúdos de tópicos clínicos distintos.
4. **Fail-Closed em Documentos Inválidos**: Qualquer inconsistência física (arquivo vazio, corrompido ou texto ilegível sem OCR) aborta a extração com erro tipado.
5. **Privacidade e Fixtures Sintéticas**: Todo teste de extração utiliza exclusivamente PDFs gerados programaticamente em `apps/api/tests/fixtures/rag/`. Nenhum dado real de paciente é utilizado.

---

## 2. Contratos de Dados e Interface

### 2.1 Identificador Canônico do Chunk (`id`)

O identificador do chunk segue o padrão:

```
${documentId}-p${page}-c${indexInPage}
```

- `documentId`: Identificador slug do manual no manifesto (ex.: `caderneta-gestante-ms-2026`).
- `page`: Número da página extraída (1-indexed). Se não identificada, usa `0`.
- `indexInPage`: Índice sequencial do chunk dentro daquela página específica (iniciando em `0`).

### 2.2 Metadados do Chunk

```javascript
{
  id: "caderneta-gestante-ms-2026-p15-c0",
  text: "...",
  metadata: {
    documentId: "caderneta-gestante-ms-2026",
    title: "Caderneta brasileira da gestante",
    year: 2026,
    page: 15,
    section: "Capítulo 3 - Consultas e Exames",
    documentType: "manual",
    chunkIndex: 0,
    totalChunksInPage: 2
  }
}
```

Campos obrigatórios validados em runtime: `documentId`, `title`, `year`.

---

## 3. Extração e Detecção Estrutural (`pdfTextExtractor.js`)

### 3.1 Normalização de Texto
- Unificação de quebras de linha (`\r\n` -> `\n`).
- Des-hifenização de fim de linha: junção de palavras separadas por hífen e quebra (`(\w+)-\n(\w+)` -> `$1$2`), preservando a integridade de termos clínicos (ex.: *hipertensão*, *anticoagulante*).
- Normalização de múltiplos espaços em branco e ligaduras tipográficas.

### 3.2 Detecção de Seções
- O extrator identifica marcadores de seções através de padrões regex:
  - `^(CAPÍTULO|SEÇÃO|PARTE)\s+\d+`
  - Numerações normativas no início de linha: `^\d+(\.\d+)*\s+[A-ZÁÉÍÓÚÂÊÔÃÕÇ]`
  - Linhas curtas em caixa alta isoladas por quebras duplas de linha.
- A seção detectada torna-se a **seção ativa** para todos os parágrafos subsequentes até que uma nova seção seja encontrada.
- Caso o início do documento não possua marcador explícito, adota-se o primeiro item de `topics` do manifesto como fallback.

### 3.3 Tratamento de Erros de Domínio (`PdfExtractionError`)

A extração lança `PdfExtractionError` com os seguintes códigos:
- `CORRUPTED_DOCUMENT`: Buffer com 0 bytes ou arquivo que falha no parser do PDF.js.
- `EMPTY_DOCUMENT`: Documento estruturalmente válido, mas com 0 páginas ou texto extraível nulo.
- `UNREADABLE_DOCUMENT`: Documento com menos de 50 caracteres úteis onde OCR não está habilitado ou falhou na taxa mínima de confiança.

---

## 4. Particionamento Determinístico (`chunkingService.js`)

- `chunkSize`: Padrão de 900 caracteres (configurável via `RAG_CHUNK_SIZE`).
- `chunkOverlap`: Padrão de 150 caracteres (configurável via `RAG_CHUNK_OVERLAP`).
- **Regra de fronteira**:
  - Quando um parágrafo ultrapassa `chunkSize`, fecha-se o chunk atual. O novo chunk inicia com o overlap do final do chunk anterior.
  - Se houver **mudança de seção**, o chunk anterior é finalizado imediatamente e o próximo chunk inicia sem overlap cruzado de texto da seção anterior.

---

## 5. Fixtures Sintéticas e Testes Automatizados

O script `scripts/generate_synthetic_rag_fixtures.js` gera as seguintes fixtures sob demanda em `apps/api/tests/fixtures/rag/`:
1. `synthetic-guideline.pdf`: Documento multi-página contendo quebras de página e duas seções clínicas bem delimitadas.
2. `synthetic-scanned.pdf`: Página rasterizada simulando scan para teste do fluxo de OCR.
3. `synthetic-empty.pdf`: PDF sem camadas de texto para validação de `EMPTY_DOCUMENT`.
4. `synthetic-corrupted.pdf`: Arquivo truncado para validação de `CORRUPTED_DOCUMENT`.

As suítes `tests/chunkingService.test.js` e `tests/pdfTextExtractor.test.js` são executadas pelo comando `npm run test:ci`.
