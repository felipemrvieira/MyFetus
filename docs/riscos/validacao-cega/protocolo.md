# Protocolo da validação cega do motor de risco

| Campo | Valor |
| --- | --- |
| Issue | E3-09.1 — Protocolo e casos sintéticos cegos (#167), subtask de E3-09 (#126) |
| Versão do protocolo | 1.0.0 |
| Estado | **Proposta — aguardando aprovação do P.O.** A rodada **não** pode começar antes da aprovação |
| Elaborado em | 2026-11-09 |
| Dependências | #97 (decisões do P.O. sobre as regras) e #117 (catálogo e `riskEngine`), ambas concluídas |
| Próximas etapas | E3-09.2 execução (#168) → E3-09.3 comparação (#169) → E3-09.4 decisão e reexecução (#170) |

> **Aviso.** Esta validação compara o motor de risco com o julgamento clínico em
> casos **sintéticos**. Ela não é validação regulatória nem autoriza uso clínico em
> produção. O motor faz triagem e não diagnostica.

---

## 1. Objetivo

Verificar se o motor de risco (`apps/api/services/riskEngine.js`), com o catálogo
congelado, classifica 20 casos sintéticos da mesma forma que o avaliador clínico,
que classifica os casos **sem ver** a saída do motor.

Critério de aceite da E3-09 (#126): **pelo menos 18 de 20 casos concordantes
(≥ 90%)**, e **nenhum caso perigoso escondido pela média** (seção 6).

---

## 2. Versão congelada (o que está sendo avaliado)

| Item | Valor |
| --- | --- |
| Catálogo | `apps/api/data/alert-rules.json`, `catalogVersion` **1.1.0** |
| SHA-256 do catálogo | `b2a7cba1ee4cfa31c6498c5180e48f3aeeca3b056fc184da03e4f905a7d01076` |
| Motor | `apps/api/services/riskEngine.js` |
| SHA-256 do motor | `1c6812f3edf374ae6c190e2746729c3c6cf9b6d3d87d0e811fbc55090c8b1f84` |
| Método do hash | SHA-256 do conteúdo com quebras de linha normalizadas para LF |
| Commit de referência | `1d7bfdd` (`main`) |
| Casos | `apps/api/data/blind-validation/cases.v1.json`, versão **1.0.0** |

Os hashes ficam gravados em `cases.v1.json`. O teste
`apps/api/tests/blindValidationDataset.test.js` **falha** se o catálogo ou o motor
mudarem. Nesse caso, a rodada fica inválida: é preciso revisar os casos, gerar uma
nova versão do conjunto e pedir nova aprovação deste protocolo.

---

## 3. Artefatos e quem pode ver cada um

O cegamento depende de cada pessoa ver só o que precisa:

| Artefato | Caminho | Conteúdo | Avaliador clínico vê? |
| --- | --- | --- | --- |
| Protocolo | `docs/riscos/validacao-cega/protocolo.md` | Este documento | Sim |
| Ficha de classificação | `docs/riscos/validacao-cega/ficha-classificacao.md` | Os 20 casos em linguagem clínica, sem resultado | **Sim — é o que ele preenche** |
| Casos (entrada do motor) | `apps/api/data/blind-validation/cases.v1.json` | Só os dados de entrada e as versões congeladas | Pode ver (não contém resultado) |
| Gabarito | `apps/api/data/blind-validation/gabarito.v1.template.json` | Modelo vazio para a classificação do avaliador | Sim (preenche) |
| Matriz de cobertura | `apps/api/data/blind-validation/coverage.v1.json` | O que cada caso exercita no catálogo | **Não**, até o gabarito estar fechado |
| Catálogo de regras e motor | `alert-rules.json`, `riskEngine.js`, `docs/regras-de-risco.md` | Limiares e regras | **Não** durante a classificação |
| Saída do motor | gerada só na E3-09.2 (#168) | Classificação do motor | **Não**, até a comparação |

A ficha é gerada a partir dos casos por `apps/api/scripts/blindValidationSheet.js`
(`node scripts/blindValidationSheet.js` em `apps/api`). Um teste garante que a
ficha está sincronizada com os casos.

---

## 4. Composição dos 20 casos

Todos os casos são sintéticos e usam os 15 campos de entrada do catálogo. A ordem
dos casos foi embaralhada para que o tipo não possa ser deduzido pela posição.

| Tipo | Quantidade | O que cobre |
| --- | --- | --- |
| Normal | 3 | Todos os parâmetros dentro das faixas |
| Limite | 6 | Um parâmetro **exatamente** no limiar de uma regra ou **imediatamente abaixo** dele (pressão, glicemia de jejum, IMC, FC fetal, idade gestacional) |
| Combinação | 3 | Mais de um parâmetro de atenção no mesmo caso, inclusive vermelho + amarelo |
| Ausência de dados | 3 | Campo obrigatório ausente (glicemia, pressão arterial, percentil da altura uterina) |
| Alto risco | 3 | Parâmetro claramente na faixa de uma regra vermelha |
| Conflitante | 2 | Dado sem resposta única pelo catálogo; candidatos a "inconclusivo" |

**Cobertura das gravidades:** os casos exercitam as **4 regras vermelhas** do
catálogo (pressão grave, FC fetal baixa, idade gestacional ≥ 42 semanas e sinal
agudo na gestação atual), regras amarelas de várias categorias, casos sem alerta e
casos com dado ausente. A distribuição por caso fica **só** na matriz de cobertura,
que o avaliador não vê antes de fechar o gabarito.

**Regras amarelas que nenhum caso aciona** (decisão a confirmar com o P.O.):
glicemia de jejum ≥ 92 (só há o caso imediatamente abaixo, 91), glicemia casual
≥ 200 (só há o caso conflitante, 150), TOTG 75 g, altura uterina fora da curva, FC
fetal acima de 160, antecedente clínico e fator de gestação anterior. Todas já têm
caso de regressão em `apps/api/data/risk-regression-fixtures.json`. Com 20 casos
não é possível acionar todas as 20 regras e ainda cobrir normal, ausência e
conflito; se o P.O. quiser, a próxima versão troca casos para incluí-las.

---

## 5. Procedimento da rodada

| Passo | Quem | O que acontece | Issue |
| --- | --- | --- | --- |
| 1 | P.O. | Aprova este protocolo e a composição dos casos (seção 9) | #167 |
| 2 | Avaliador clínico | Preenche a ficha **sem acesso** ao motor, ao catálogo ou à matriz | #167 → #168 |
| 3 | Equipe | Transcreve a ficha para `gabarito.v1.json` (a partir do modelo), sem alterar respostas, e versiona o gabarito **antes** de rodar o motor | #168 |
| 4 | Equipe | Roda o motor nos 20 casos com as versões congeladas e grava a saída em arquivo separado | #168 |
| 5 | Equipe | Compara gabarito × motor e gera o relatório de concordância | #169 |
| 6 | P.O. | Decide sobre cada divergência; se houver ajuste de regra, nova rodada | #170 |

**Regra de ordem:** o gabarito precisa estar fechado e versionado (passo 3) antes
de qualquer execução do motor (passo 4). Se o motor for executado antes, a rodada
perde o cegamento e deve ser refeita com um novo conjunto de casos.

---

## 6. Classificação e critério de concordância

### 6.1 Escala do avaliador

Para cada caso, o avaliador marca **uma** classificação geral:

| Classificação | Significado |
| --- | --- |
| Verde | Sem sinal de atenção |
| Amarelo | Sinal de atenção ou risco intermediário |
| Vermelho | Sinal crítico ou atenção imediata |
| Inconclusivo | O caso não tem resposta clínica única |

E marca, à parte, **"faltam dados"** quando um dado ausente impede avaliar parte do
caso. A justificativa é obrigatória para vermelho, inconclusivo e "faltam dados".

### 6.2 Como a saída do motor é lida

| Saída do motor | Equivale a |
| --- | --- |
| `overallSeverity` = `green` | Verde |
| `overallSeverity` = `yellow` | Amarelo |
| `overallSeverity` = `red` | Vermelho |
| Alguma categoria com `status` = `pending_data` | "Faltam dados" |

> **Atenção (achado ao montar o protocolo).** Quando falta um dado obrigatório, o
> motor marca a categoria como `pending_data`, mas a gravidade geral
> (`overallSeverity`) continua `green` se as demais categorias estiverem normais.
> Por isso a comparação **sempre** considera também a pendência (linha acima):
> um caso com dado ausente nunca pode ser contado como "verde concordante" só pela
> gravidade geral. Quem consome `overallSeverity` em outras partes do sistema deve
> levar isso em conta. Registrado aqui para análise em E3-09.3/E3-09.4; este
> protocolo não altera o motor.

### 6.3 Concordância

Um caso é **concordante** quando:
1. a classificação geral do avaliador é igual à do motor (verde, amarelo ou vermelho); **e**
2. a marcação "faltam dados" do avaliador coincide com a pendência do motor.

- Casos **inconclusivos** saem do cálculo da meta e entram no relatório com a
  justificativa. Se houver **mais de 2** inconclusivos, a rodada é inválida e os
  casos devem ser revistos.
- **Meta:** concordantes ÷ casos conclusivos **≥ 90%**, com pelo menos 18 casos
  conclusivos.
- **Bloqueio independente da média:** qualquer caso em que o avaliador marcou
  **vermelho** e o motor **não** marcou vermelho (falso negativo crítico) reprova a
  rodada, mesmo com a meta atingida.
- Falsos positivos (motor mais grave que o avaliador) são listados e analisados,
  mas não têm o mesmo peso.
- Nenhuma divergência é corrigida em silêncio: cada uma vira ajuste de regra,
  regra nova ou removida, ou decisão clínica registrada (E3-09.4, #170).

---

## 7. Dados sintéticos e privacidade

- Nenhum caso tem nome, documento, endereço, telefone, e-mail ou data real.
- Os casos têm só os campos numéricos e categóricos do catálogo.
- O teste do conjunto falha se aparecer campo fora do catálogo ou texto com padrão
  de e-mail, CPF ou telefone.
- O relatório da rodada (E3-09.3) não deve conter dado pessoal do avaliador além do
  nome e da data de assinatura.

---

## 8. Testes automatizados

`apps/api/tests/blindValidationDataset.test.js` (no `npm run test:ci`) garante que:

- o conjunto tem exatamente 20 casos, com IDs únicos `BV-01` a `BV-20`;
- o catálogo e o motor não mudaram desde o congelamento (hash);
- os casos só usam campos do catálogo e passam na validação de entrada do motor;
- os casos **não** contêm resultado esperado, regra-alvo nem gravidade (cegamento);
- não há padrão de dado pessoal;
- a matriz de cobertura descreve todos os casos, com a quantidade de cada tipo da
  seção 4, cobre as 4 regras vermelhas e bate com os valores e limiares do catálogo;
- o modelo do gabarito tem os 20 casos, todos vazios, e não contém saída do motor;
- a ficha de classificação está sincronizada com os casos.

O teste **não** executa o motor de risco: a execução é a E3-09.2 (#168).

---

## 9. Decisões pendentes do P.O.

As perguntas abaixo estão na #126 e na #167 e ainda não foram respondidas. Este
protocolo usa as sugestões da equipe como **proposta**.

| # | Decisão | Proposta deste protocolo |
| --- | --- | --- |
| 1 | Quem classifica e quem consolida | P.O./médico responsável classifica; equipe só transcreve e consolida, sem alterar respostas |
| 2 | O que o avaliador vê | Só a ficha e este protocolo; não vê motor, catálogo nem matriz |
| 3 | Tipos e quantidades de casos | Seção 4 (3 normal, 6 limite, 3 combinação, 3 ausência, 3 alto risco, 2 conflitante) |
| 4 | Concordância exata ou com tolerância | Exata por classificação geral + marcação de "faltam dados" |
| 5 | Abaixo de 90% | Bloqueia a conclusão; divergências viram ajuste ou decisão; nova rodada |
| 6 | Falso negativo crítico | Reprova a rodada, independentemente da média |
| 7 | Casos sem resposta única | "Inconclusivo", fora da meta; mais de 2 invalida a rodada |
| 8 | Segunda rodada | Sim, sempre que mudar limiar, gravidade ou regra (novo hash) |
| 9 | Campos do relatório | Versão do catálogo e do motor, conjunto, avaliador, resultado por caso, divergências, decisão e limitações |
| 10 | Regras amarelas sem caso no conjunto | Confirmar se as 7 regras listadas na seção 4 ficam só nos testes de regressão |

### Registro de aprovação

| Item | Decisão (aprovado / ajustar / rejeitado) | Responsável | Data |
| --- | --- | --- | --- |
| Protocolo v1.0.0 | | | |
| Conjunto de casos v1.0.0 | | | |
