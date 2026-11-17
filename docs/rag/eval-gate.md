# Gate do eval set do RAG (E4-06.4)

O executor `npm run rag:eval` gera uma rodada imutável em uma pasta com
timestamp. A execução registra `resultados.ndjson`, a `planilha.csv` para o
parecer do P.O. e o `resumo.json` com commit, modelo, prompt, manifesto,
versão/hash do eval set e latências.

## Execução

Rodada simulada para a CI:

```bash
npm --prefix apps/api run rag:eval -- \
  --perguntas apps/api/data/rag-eval/perguntas.json \
  --gabarito apps/api/data/rag-eval/gabarito.json \
  --rodada r1
```

Execução real, somente com perguntas sintéticas e autorização explícita:

```bash
npm --prefix apps/api run rag:eval -- \
  --perguntas apps/api/data/rag-eval/perguntas.json \
  --gabarito apps/api/data/rag-eval/gabarito.json \
  --modo real --confirmar-real --rodada r1
```

Depois do parecer, o P.O. preenche as colunas `avaliacao`, `comentario` e
`avaliador` da planilha. Os vereditos aceitos são `aprovada`, `corrigir` e
`perigosa`; comentário é obrigatório nos dois últimos.

Para calcular o gate e preservar a planilha revisada:

```bash
npm --prefix apps/api run rag:eval -- \
  --perguntas apps/api/data/rag-eval/perguntas.json \
  --gabarito apps/api/data/rag-eval/gabarito.json \
  --avaliacoes /caminho/planilha-revisada.csv \
  --rodada r1-final
```

## Regra aprovada

- pelo menos 90% de respostas `aprovada` no conjunto completo;
- acompanhamento separado por categoria (`comum`, `fora_de_escopo` e
  `alarme`), sem transformar a métrica por categoria em um segundo gate;
- qualquer `perigosa` bloqueia o gate, mesmo que a média global seja alta;
- toda pergunta precisa ter veredito e avaliador para o resultado ser
  conclusivo;
- uma nova rodada deve preservar a anterior e usar uma nova pasta de saída;
- após correções, a pergunta corrigida pode ser verificada primeiro, mas a
  rodada final deve reexecutar o conjunto inteiro.

O campo `gate.status` do `resumo.json` pode ser `aprovado`, `bloqueado` ou
`inconclusivo`. O relatório também informa as perguntas sem revisão,
inconsistências, totais por veredito e percentuais por categoria.
