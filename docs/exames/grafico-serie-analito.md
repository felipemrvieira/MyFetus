# Gráfico da Série de um Analito (E2-06, Issue #101)

Implementação do gráfico longitudinal da evolução de analitos aceitos ao longo da gestação.
Decisões clínicas aprovadas pelo P.O. Dr. Rui Pontes em 29/10/2026.
Depende da E2-04 (#61, revisão médica de analitos).

## Regras Clínicas e de Negócio

1. **Analitos da v1**:
   - Hemoglobina (`hemoglobin`): unidade padrão `g/dL`, limite clínico normativo gestacional fixado em **11 g/dL** (valores inferiores acionam sinalização visual).
   - Glicemia de Jejum (`glucose` com `exam_type = 'fasting'`): unidade padrão `mg/dL`, limite normativo fixado em **92 mg/dL** (valores superiores acionam sinalização). TOTG e glicemia casual são estritamente excluídos da série temporal.
2. **Fontes de Referência**:
   - Faixa do laboratório: extraída do laudo original e preservada em cada ponto (`reference_low` e `reference_high`).
   - Limite normativo obstétrico: linha horizontal contínua de destaque no gráfico para rápida orientação médica.
3. **Mínimo de Pontos e Cálculo de Tendência**:
   - Um ponto isolado aparece como dado sem linha conectora.
   - Dois pontos conectam a linha de medição real.
   - Cálculo de tendência matemática (regressão linear de primeiro grau) é ativado exclusivamente com **3 ou mais pontos na mesma unidade**, classificando em:
     * `Estável`
     * `Em elevação`
     * `Em declínio`
   - **Sem interpolação**: Pontos intermediários ausentes não são artificialmente interpolados (conforme ADR 0006).
4. **Política de Unidades**:
   - Bloqueio estrito de mistura de grandezas sem conversão validada.
   - Caso existam exames em unidade divergente (ex.: `g/L` em vez de `g/dL`), a curva plota apenas a série principal, sinaliza alerta de divergência (`unit_conflict: true`) e apresenta todos os registros na tabela detalhada.
5. **Público e Segurança**:
   - Acesso exclusivo ao médico vinculado à gestante (`requireRole('medico')` e vínculo ativo em `doctor_patient_links`).
   - Gestantes e administradores não acessam a rota na v1 (403 Forbidden).
   - Acesso gera evento de auditoria `LAB_RESULTS_SERIES_VIEWED` sem vazamento de dados de saúde no log.
6. **Acessibilidade e Aviso Legal**:
   - Tabela alternativa textual semântica com leitura integral para leitores de tela (TalkBack / VoiceOver).
   - Aviso obrigatório em todas as exibições: *"Histórico para acompanhamento clínico. Não é diagnóstico."*

## API

- **Rota**: `GET /api/lab-results/pregnant/:pregnantId/series/:analyteId`
- **Path Params**:
  * `pregnantId` (obrigatório, inteiro positivo)
  * `analyteId` (obrigatório: `hemoglobin` ou `glucose` / `fasting_glucose`)
- **Resposta**: `LabResultSeriesResponse` (OpenAPI 3.1)

## Arquitetura e Componentes

- **Backend**:
  * [apps/api/services/labResultSeriesService.js](../../apps/api/services/labResultSeriesService.js): cálculo de idade gestacional a partir da DUM, ordenação temporal, filtro de jejum, classificação de tendência e detecção de conflitos de unidade.
  * [apps/api/controllers/labResultsController.js](../../apps/api/controllers/labResultsController.js): `getLabResultSeries`.
  * [apps/api/routes/labResults.js](../../apps/api/routes/labResults.js): registro da rota sob autenticação médica.
- **Frontend Mobile**:
  * [apps/mobile/utils/analyteChartData.ts](../../apps/mobile/utils/analyteChartData.ts): tipos, formatação para VictoryChart e cálculo dinâmico de domínio Y.
  * [apps/mobile/components/AnalyteSeriesChart.tsx](../../apps/mobile/components/AnalyteSeriesChart.tsx): componente visual com gráfico VictoryChart, badges de tendência, linha normativa e tabela textual de acessibilidade.
  * [apps/mobile/app/doctor/[patientId]/serie_analitos.tsx](../../apps/mobile/app/doctor/[patientId]/serie_analitos.tsx): tela médica com abas de seleção entre Hemoglobina e Glicemia de Jejum.
  * [apps/mobile/app/doctor/[patientId]/historico_exames.tsx](../../apps/mobile/app/doctor/[patientId]/historico_exames.tsx): botão de acesso à série a partir da lista de exames.
