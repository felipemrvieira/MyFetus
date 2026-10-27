# Operação da ingestão do RAG

Este documento descreve como acompanhar, reprocessar e fazer rollback de uma
ingestão de manuais aprovados. Os comandos não imprimem texto de chunks,
embeddings, prompts ou dados de pacientes.

## Ingestão

```bash
cd apps/api
npm run rag:ingest
```

Ao final, o processo grava um relatório JSON em
`apps/api/data/rag-reports/`. O arquivo contém namespace, versão do manifesto,
duração, documentos, chunks, vetores, itens ignorados e falhas sanitizadas.

Uma execução com falha de documento retorna código de saída diferente de zero,
mas mantém o relatório para diagnóstico. O checkpoint só é salvo depois que o
upsert completo daquele documento termina.

## Estatísticas

```bash
cd apps/api
npm run rag:stats
```

O resultado combina as estatísticas do vector store com o relatório mais
recente e o checkpoint. A saída separa namespace, documento, quantidade de
chunks e quantidade de vetores.

## Rollback de um documento

O rollback exige o `documentId` explícito; não existe comando de limpeza ampla
por acidente:

```bash
cd apps/api
npm run rag:rollback -- caderneta-gestante-ms-2026
```

O comando remove os vetores do documento no namespace configurado e remove sua
entrada do checkpoint. Para reindexar depois do rollback:

```bash
RAG_FORCE_INGEST=true npm run rag:ingest
```

Se modelo, dimensão ou namespace forem alterados, o mesmo reprocessamento
forçado deve ser executado. O ambiente real deve fornecer `PINECONE_API_KEY`;
o modo mock é reservado para testes e desenvolvimento controlado.
