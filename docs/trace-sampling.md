# Sampling de traces no Collector

O ambiente local usa tail sampling no pipeline de traces. Depois de receber o
primeiro span, o Collector aguarda 5 segundos antes de decidir:

- traces com ao menos um span com status OpenTelemetry `ERROR` sao selecionados;
- traces com duracao de pelo menos 500 ms sao selecionados;
- 10% dos demais traces sao selecionados probabilisticamente.

A duracao e a diferenca entre o primeiro inicio e o ultimo fim dos spans vistos
na janela. Os valores sao um ponto de partida para demonstracao local, nao uma
meta de producao. Metricas e logs nao passam por esse sampling. Logs podem
apontar para traces que nao foram armazenados. O endpoint de sugestoes de
incidente usa um limiar demonstrativo diferente de 100 ms.

## Limites e operacao

As regras de erro e latencia selecionam 100% dos traces que correspondem aos
spans disponiveis quando a decisao e tomada; isso nao garante entrega integral.
Spans descartados na origem, atrasados mais de 5 segundos, perdidos em falhas,
ou removidos por pressao de memoria/capacidade podem impedir uma decisao
correta. O processador guarda no maximo 10.000 traces pendentes e mantem caches
de 50.000 decisoes para cada resultado. Uma reinicializacao perde o estado em
memoria. Ajuste esses limites e a janela com base em trafego e memoria medidos.
Para multiplas replicas, todos os spans do mesmo trace devem chegar a mesma
instancia do Collector. Traces precisam ter status `ERROR` instrumentado;
um erro representado apenas como atributo ou log nao corresponde a essa regra.

Para mudar a politica local, edite `observability/otel-collector/config.yaml`,
valide com `npm run validate:observability` e recrie o Collector. Para reverter,
remova `tail_sampling` da lista de processadores do pipeline de traces e recrie
o Collector. Monitore o uso de memoria, os erros de exportacao e as metricas
`otelcol_processor_tail_sampling_*`; nao use traces amostrados para calcular
volumes ou taxas de erro sem considerar o vies de selecao.

## Verificacao

`npm run smoke:observability` envia traces sinteticos de erro, lentos e saudaveis
e verifica no Tempo a selecao dos dois primeiros e a presenca de traces
saudaveis retidos e descartados. A amostra probabilistica pode variar entre
execucoes. A verificacao exige a stack local e nao mede perda sob carga, spans
atrasados ou recuperacao apos falha.
