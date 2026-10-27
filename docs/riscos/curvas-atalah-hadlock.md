# Curvas Atalah e Hadlock — baseline técnica

Esta entrega corrige dois problemas técnicos identificados na implementação das curvas:

- restaura o ponto da semana 28 da curva Atalah para `28,4`, valor que já existia na implementação anterior e cuja regressão para `25,9` quebrava a monotonicidade da série;
- calcula P10/P50/P90 de Hadlock usando a mesma distribuição log-normal do cálculo de percentil individual, em vez de somar/subtrair um desvio linear ao P50.

## O que ainda não foi decidido

Esta correção não representa aprovação clínica nova. Permanecem pendentes para o PO/responsável clínico:

- confirmar a referência final (Hadlock ou Intergrowth) e a população/edição da curva;
- fornecer e aprovar os 10 casos de referência, com idade gestacional, medidas, resultado esperado e tolerância;
- confirmar unidades, faixa de idade gestacional suportada, arredondamento e tratamento de valores fora do domínio;
- validar visualmente a curva no mobile e registrar a fonte aprovada.

Os testes automatizados verificam monotonicidade, limites matemáticos e regressão da semana 28, mas não substituem a validação clínica.
