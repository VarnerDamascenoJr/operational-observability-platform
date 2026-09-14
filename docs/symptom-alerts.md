# Alertas baseados em sintomas

Os alertas locais partem de sintomas visiveis para o usuario ou para a jornada de
negocio. Eles evitam causas internas como criterio primario. A primeira acao de
resposta sempre deve confirmar impacto no dashboard, depois navegar para trace e
logs correlacionados.

As regras ficam em
`observability/prometheus/rules/operational-alerts.yml` e sao carregadas pelo
Prometheus local. Os limiares desta etapa foram escolhidos para a demonstracao
local da API `/demo/transactions`. As regras de erro e latencia usam os
contadores da execucao atual do processo da API, que sao reiniciados no smoke; em
um ambiente real, elas devem ser convertidas para janelas baseadas em historico
de trafego e objetivos do servico.

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

Sintoma: duracao media acumulada de requisicoes de uma rota na execucao local
atual passou do limiar demonstrativo.

Causa provavel inicial:

- dependencia lenta;
- fila ou etapa assincrona demorando mais que o normal;
- saturacao local do processo ou do banco.

Primeira acao:

1. Abrir o dashboard `Operational Observability - Service Technical`.
2. Confirmar se a rota afetada e `/demo/transactions` e se ha trafego com
   `dependency=slow`.
3. Abrir traces recentes no Tempo e verificar qual span concentra a duracao.
4. Consultar logs no Loki filtrando pelo `trace_id` do trace lento.

Cuidado contra duplicidade: se erro HTTP alto e latencia alta dispararem juntos,
comece pela latencia quando a maioria das respostas ainda for 2xx; comece por
erro quando a rota estiver falhando para usuarios.

## Consumo acelerado de error budget

Alerta: `OOPSloErrorBudgetBurn`

Severidade: `page`

Sintoma: a ultima avaliacao de SLO consumiu mais de 100% do error budget para um
SLI.

Causa provavel inicial:

- falhas ou lentidao suficientes para violar o alvo do SLO;
- uma janela de avaliacao pequena amplificando uma degradacao curta;
- SLO configurado com alvo mais estrito que o comportamento demonstrado.

Primeira acao:

1. Abrir o dashboard `Operational Observability - Demo Business Transactions`.
2. Conferir sucesso, falha, degradacao e duracao na mesma janela do SLO.
3. Consultar `GET /slos/<slo-id>/status` para confirmar o SLI violado.
4. Usar os alertas tecnicos ativos para escolher a rota ou dependencia que deve
   ser investigada primeiro.

Cuidado contra duplicidade: este alerta representa priorizacao por impacto. Se
alertas tecnicos tambem estiverem ativos, mantenha um unico incidente orientado
pelo SLO e anexe os alertas de erro ou latencia como evidencias.
