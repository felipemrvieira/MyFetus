# Parser técnico de resultados laboratoriais

O parser em `apps/api/services/labResultParser.js` transforma texto sintético de
exame em resultados estruturados sem acionar o motor de risco. Cada resultado
carrega analito, LOINC quando confirmado, valor numérico ou textual, unidade,
referência, data explícita, confiança, texto original, versão do parser e motivo
de ambiguidade.

Um resultado só recebe `status: accepted` quando o analito tem mapeamento LOINC,
o valor foi reconhecido, a unidade está presente e a data do exame foi informada
ou fornecida pelo chamador. Caso contrário, recebe `pending_review`; texto não
reconhecido fica em `unrecognized_text`.

Esta etapa não define limiares clínicos, não corrige OCR silenciosamente e não
envia resultados ao motor de risco. A persistência em `lab_results`, a revisão
clínica e a definição dos critérios de acurácia continuam nas etapas E2-04/E2-07.
