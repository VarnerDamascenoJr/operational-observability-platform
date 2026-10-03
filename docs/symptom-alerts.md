# Alertas baseados em sintomas

Os alertas locais partem de sintomas visiveis para o usuario ou para a jornada de
negocio. Eles evitam causas internas como criterio primario. A primeira acao de
resposta sempre deve confirmar impacto no dashboard, depois navegar para trace e
logs correlacionados.

As regras ficam em
`observability/prometheus/rules/operational-alerts.yml` e sao carregadas pelo
Prometheus local. Os limiares desta etapa foram escolhidos para a demonstracao
local da API `/demo/transactions`. A regra de erro usa contadores e a regra de
latencia usa histogramas Prometheus com p95 em janela curta. Em um ambiente real,
elas devem ser calibradas com historico de trafego e objetivos do servico.

## Erro HTTP alto

Alerta: `OOPHighHttpErrorRate`

Severidade: `warning`

Sintoma: mais de 20% das requisicoes acumuladas de uma rota na execucao local
atual retornaram 5xx.

Causa provavel inicial:

- dependencia externa indisponivel;
- erro de validacao tratado como falha de servidor;
- regressao recente em uma rota especifica.

Primeira acao:

1. Abrir o dashboard `Operational Observability - Service Technical`.
2. Filtrar `service`, `environment` e a rota afetada.
3. Copiar um `trace_id` de uma requisicao com erro.
4. Abrir o trace no Tempo e os logs no Loki pelo mesmo `trace_id`.

Cuidado contra duplicidade: se `OOPSloErrorBudgetBurn` tambem estiver disparado,
trate este alerta como sintoma tecnico da rota e use o alerta de error budget
para priorizar impacto de negocio.

## Latencia HTTP alta

Alerta: `OOPHighHttpLatency`

Severidade: `warning`

Sintoma: p95 de duracao de requisicoes de uma rota passou do limiar
demonstrativo.

Causa provavel inicial:

- dependencia lenta;
- fila ou etapa assincrona demorando mais que o normal;
- saturacao local do processo ou do banco.

Primeira acao:

1. Abrir o dashboard `Operational Observability - Service Technical`.
2. Comparar media e p95 em `GET /metrics/latency-distribution`.
3. Confirmar se a rota afetada e `/demo/transactions` e se ha trafego com
   `dependency=slow`.
4. Abrir traces recentes no Tempo e verificar qual span concentra a duracao.
5. Consultar logs no Loki filtrando pelo `trace_id` do trace lento.

Cuidado contra duplicidade: se erro HTTP alto e latencia alta dispararem juntos,
comece pela latencia quando a maioria das respostas ainda for 2xx; comece por
erro quando a rota estiver falhando para usuarios.

## Consumo acelerado de error budget

Alerta: `OOPSloErrorBudgetBurn`

Severidade: `page`

Sintoma: as janelas curta e longa de um SLI estao consumindo error budget acima
do ritmo esperado para o horizonte do SLO.

Causa provavel inicial:

- falhas ou lentidao suficientes para violar o alvo do SLO;
- degradacao curta forte o bastante para elevar a janela curta;
- degradacao sustentada confirmada pela janela longa;
- SLO configurado com alvo mais estrito que o comportamento demonstrado.

Primeira acao:

1. Abrir o dashboard `Operational Observability - Demo Business Transactions`.
2. Conferir sucesso, falha, degradacao e duracao nas janelas curta e longa.
3. Consultar `GET /slos/<slo-id>/burn-rate` para confirmar qual SLI esta
   queimando orçamento rapido demais.
4. Consultar `GET /slos/<slo-id>/status` para confirmar o estado atual do SLI.
5. Consultar `GET /slos/<slo-id>/process-control` para separar pico isolado de
   mudanca sustentada contra o historico recente.
6. Usar os alertas tecnicos ativos para escolher a rota ou dependencia que deve
   ser investigada primeiro.

Cuidado contra duplicidade: este alerta representa priorizacao por impacto. Se
alertas tecnicos tambem estiverem ativos, mantenha um unico incidente orientado
pelo SLO e anexe os alertas de erro ou latencia como evidencias.

## Anomalia estatistica de processo

Sinal: `GET /slos/<slo-id>/process-control`

Severidade: `watch` para `isolated_spike`; `warning` para `sustained_shift`.

Sintoma: a taxa de eventos ruins saiu do limite historico calculado por EWMA.

Causa provavel inicial:

- mudanca sustentada de latencia ou erro ainda abaixo de um limiar fixo;
- pico operacional que merece acompanhamento, mas nao nova pagina imediata;
- baseline recente pequeno demais para conclusao forte.

Primeira acao:

1. Conferir `baseline.meanBadEventPercentage` e `upperControlLimit`.
2. Se `pattern=sustained_shift`, anexar o objeto `evidence` da anomalia ao
   incidente ativo.
3. Cruzar a janela anomalas com dashboards, traces e logs antes de apontar causa
   raiz.
