# E2-07: Valores Aceitos de Exames Disparam Regras de Risco (#100)

## 1. Contexto e Objetivo
Esta especificação descreve a integração entre a revisão médica dos resultados laboratoriais (E2-04 / #61) e o motor de alertas e estratificação de risco (E2-07 / #100 / E3-03).
Quando um médico revisa e aceita ou corrige analitos extraídos de laudos de exames, os valores aprovados devem disparar automaticamente as regras clínicas correspondentes para triagem obstétrica segura, sem duplicar limiares nas camadas de apresentação e preservando a idempotência e o histórico.

## 2. Requisitos e Critérios Clínicos
Conforme as diretrizes obstétricas (MS 2012 / MS 2022) e o catálogo de regras versionado:

### A. Hemoglobina (`hemoglobin` / Hb)
* **Unidade esperada:** `g/dL` (ou equivalente estrito).
* **Crítico (`red`):** `Hb < 8,0 g/dL` — Anemia grave na gestação. Orientação de encaminhamento obstétrico de emergência / maternidade de alto risco.
* **Atenção (`yellow`):** `8,0 <= Hb < 11,0 g/dL` — Anemia gestacional. Orientação de investigação etiológica e avaliação de suplementação terapêutica de ferro.
* **Normal (`green`):** `Hb >= 11,0 g/dL` — Fecha automaticamente alertas de anemia anteriormente abertos para a mesma gestação.
* **Dado insuficiente / Unidade incompatível:** Caso o laudo traga unidade incompatível ou valor não numérico, nenhum alerta é gerado e a ocorrência é auditada como dado insuficiente.

### B. Glicemia (`glucose`)
* **Unidade esperada:** `mg/dL`.
* **Jejum (`fasting`):**
  * `>= 92 mg/dL`: Alerta Amarelo (`lab_glucose_fasting`).
  * `< 92 mg/dL`: Normal (fecha alerta anterior aberto).
* **Casual (`casual`):**
  * `>= 200 mg/dL`: Alerta Amarelo (`lab_glucose_casual`).
  * `< 200 mg/dL`: Normal (fecha alerta anterior aberto).
* **TOTG 75 g (`ogtt75g`):**
  * `0h` (jejum): `>= 92 mg/dL` -> Alerta Amarelo (`lab_glucose_ogtt_0h`).
  * `1h`: `>= 180 mg/dL` -> Alerta Amarelo (`lab_glucose_ogtt_1h`).
  * `2h`: `>= 153 mg/dL` -> Alerta Amarelo (`lab_glucose_ogtt_2h`).
  * Valores inferiores ao ponto de corte: Normal (fecha alerta anterior aberto).
* **Segurança na Comunicação:** A mensagem não emite diagnósticos taxativos de "diabetes" ou "pré-diabetes" para a paciente, orientando registro e acompanhamento médico contínuo.

### C. Proteinúria (`urine_protein`)
* **Qualitativo (fita reagente):** Presença de `1+`, `2+`, `3+`, `4+`, `+`, `positivo` ou `reagente` -> Alerta Amarelo (`lab_urine_protein_elevated`).
* **Quantitativo:** `>= 30 mg/dL` (ou `>= 300 mg/L`) -> Alerta Amarelo (`lab_urine_protein_elevated`).
* **Negativo / Normal:** `< 30 mg/dL`, `negativo`, `não reagente`, `ausente` ou `traços` -> Normal (fecha alerta aberto de proteinúria).

## 3. Arquitetura e Ciclo de Vida do Alerta
1. **Gatilho de Disparo:**
   * O acionamento ocorre na finalização da transação médica de revisão (`acceptLabResult`, `correctLabResult`, `reopenLabResult`, `rejectLabResult`).
   * Somente analitos com status `accepted` ou `corrected` (ou seja, `clinically_usable`) acionam a avaliação de risco.
   * Resultados em `pending` ou `rejected` nunca disparam regras nem geram alertas.
2. **Idempotência (`alert_events`):**
   * Cada alerta é vinculado à `pregnancy_id`, `pregnant_id`, `rule_id`, `severity` e com `source_type = 'lab_result'`.
   * Caso o médico repita ou salve novamente o mesmo resultado com a mesma severidade, a linha é atualizada em `last_seen_at` sem duplicar eventos.
3. **Fechamento e Invalidação:**
   * **Nova medida normal:** O serviço fecha automaticamente alertas ativos correlatos via `autoCloseNormalAlert`.
   * **Reabertura ou Rejeição:** Se uma decisão médica anterior é reaberta (`reopen`) ou rejeitada (`reject`), os alertas em aberto originados naquele `lab_result_id` são desativados com o registro do motivo.

## 4. Apresentação (Dashboard e Alertas)
* **Dashboard do Médico:** O endpoint `/api/pregnants` retorna o campo computado `alert_level` (refletindo severidade `red` ou `yellow` ativa). No aplicativo mobile, pacientes com alertas em aberto são destacadas com indicação de risco e acesso direto aos alertas.
* **Tela de Alertas:** A rota `/api/pregnants/:id/alerts` computa e exibe as categorias de `Hemoglobina`, `Glicemia` e `Proteinúria`, atualizando a Classificação Geral (`overall_level`) e a contagem por gravidade.

## 5. Auditoria e Privacidade (LGPD)
* A criação de alertas acionados por exames é registrada na auditoria como `ALERT_TRIGGERED_FROM_LAB_RESULT`, registrando `analyte_id`, `rule_id` e `severity`, sem expor o valor clínico no log de auditoria.
* Os dados sensíveis continuam protegidos por envelope criptográfico AES nas tabelas subjacentes.
