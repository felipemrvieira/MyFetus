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
envia resultados ao motor de risco. O `status: accepted` do parser só quer dizer que a
leitura está completa; quem decide o uso clínico é o médico. A persistência em `lab_results`
e a revisão médica estão em [revisao-medica-analitos.md](revisao-medica-analitos.md) (E2-04);
a ligação com o motor de risco fica na E2-07.

Na glicemia, o tipo do exame só é preenchido quando está escrito na linha (jejum, TOTG 75 g
com o tempo, ou casual). Sem o tipo, o médico informa na revisão.
