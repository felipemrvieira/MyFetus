# Série Temporal de Analitos Sem Interpolação e Bloqueio de Unidades Mistas

Séries temporais de analitos laboratoriais (E2-06, Issue #101) exibem a evolução longitudinal de medições bioquímicas obstétricas (hemoglobina e glicemia de jejum) ao longo da gestação, consumindo exclusivamente registros com status `accepted` ou `corrected`.

Decidimos proibir qualquer forma de interpolação matemática de pontos faltantes e bloquear a unificação de séries com unidades de medida divergentes (sem conversão heurística automática na v1). Além disso, o cálculo de tendência direcional exige um mínimo estrito de 3 pontos na mesma unidade.

Essa escolha prioriza a segurança clínica e a rastreabilidade sobre a estética visual: interpolar dados de saúde poderia induzir falsas impressões de estabilidade ou normalidade entre consultas, e converter unidades laboratoriais sem chancela regulatória introduziria risco inaceitável de erro de dosagem ou conduta diagnóstica.
