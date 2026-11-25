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

Resposta e recuperacao:

1. Se os traces indicarem dependencia indisponivel, siga
   [Dependencia indisponivel](#dependencia-indisponivel). Caso contrario, compare
   o inicio das falhas com mudancas recentes e encaminhe ao responsavel pelo
   servico; use rollback apenas quando houver procedimento autorizado.
2. Acompanhe respostas 5xx e transacoes bem-sucedidas apos a mitigacao. A regra
   atual de erro usa contadores acumulados desde o inicio do processo: ela pode
   permanecer ativa mesmo apos a recuperacao e nao deve ser a unica confirmacao.
3. Registre a evidencia, a mitigacao e a verificacao no incidente antes de
   encerra-lo. Se o impacto persistir, acione o responsavel pelo servico.

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

Resposta e recuperacao:

1. Compare o tempo da dependencia com o tempo total do trace. Se a dependencia
   estiver indisponivel, siga [Dependencia indisponivel](#dependencia-indisponivel);
   se estiver lenta, envolva seu responsavel e evite aumentar timeouts ou
   tentativas sem avaliar o impacto no servico.
2. Apos a mitigacao, acompanhe o p95 na janela de cinco minutos, o volume de
   requisicoes e os erros. Confirme recuperacao com trafego representativo e
   registre a evidencia no incidente; se a degradacao persistir, escale ao
   responsavel pelo servico.

Cuidado contra duplicidade: se erro HTTP alto e latencia alta dispararem juntos,
comece pela latencia quando a maioria das respostas ainda for 2xx; comece por
erro quando a rota estiver falhando para usuarios.

## Dependencia indisponivel

Sintoma: requisicoes falham e traces apontam para uma chamada de dependencia
com erro ou timeout. A indisponibilidade da dependencia e uma hipotese ate ser
confirmada; erro de aplicacao ou configuracao incorreta podem parecer iguais.

Diagnostico e resposta:

1. Confirme o impacto no dashboard tecnico e no dashboard de transacoes. Anote
   servico, ambiente e intervalo; nao trate a ausencia de telemetria como prova
   de recuperacao.
2. Abra `GET /incidents/<incident-id>/suggestions` quando houver incidente,
   execute a consulta de traces sugerida no Tempo e consulte os logs do mesmo
   `trace_id` no Loki. Identifique a dependencia e o erro retornado, sem expor
   credenciais ou dados sensiveis nas evidencias.
3. Verifique o estado da dependencia por seus meios de diagnostico autorizados
   e acione seu responsavel. Quando houver mitigacao ou rollback documentado e
   autorizado para o servico afetado, aplique-o; nao reinicie servicos nem
   altere timeouts, retries ou infraestrutura apenas com base neste roteiro.
4. Confirme a recuperacao com requisicoes representativas, queda de erros,
   melhora do p95 e transacoes bem-sucedidas. Registre causa, mitigacao e
   evidencias no incidente. Se o impacto persistir, escale ao responsavel.

No ambiente local de demonstracao, `dependency=unavailable` provoca uma resposta
503 controlada em `/demo/transactions`; o parametro nao testa uma dependencia
externa real. Nao use essa simulacao em um ambiente compartilhado ou de
producao. O exemplo completo esta em
[Investigacao pelos dashboards locais](dashboard-investigation.md).

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

## Queda de transacoes bem-sucedidas

Alerta: `OOPSuccessfulTransactionsDrop` (`warning`). A taxa de sucessos nos
ultimos cinco minutos fica abaixo de metade da taxa da hora anterior durante
cinco minutos. A comparacao so existe com pelo menos dez sucessos na hora de
referencia. Esta e uma regra de demonstracao: uma queda de demanda normal pode
dispara-la e a ausencia de metricas deve ser investigada separadamente. Ajuste
janelas, volume minimo e limiar ao historico e ao servico antes de usa-la fora
do ambiente local.

1. Confirmar no dashboard de transacoes se houve queda de demanda ou aumento de
   falhas; nao presumir indisponibilidade apenas pela queda de volume.
2. Investigar o servico, os traces e os logs da janela afetada.

## Roteamento e estados locais

Prometheus envia as regras ao Alertmanager, que agrupa por nome, servico e
ambiente e envia notificacoes e resolucoes para a API. A configuracao de
recebedor e local e nao envia notificacoes a pessoas. O Alertmanager usa
`http://host.docker.internal:3103/alerts/webhook`; execute a API no host com
`HOST=0.0.0.0 PORT=3103 npm run start` apos subir o banco, aplicar migrations e
fazer o build. Para outra porta, ajuste explicitamente o arquivo de
configuracao do Alertmanager. O Prometheus tambem coleta a API na porta 3103.
O endpoint nao tem autenticacao e destina-se somente a redes locais confiaveis.

`GET /alerts` retorna ate 1000 alertas, ordenados pela ultima atualizacao;
`GET /alerts?status=firing` ou `?status=resolved` filtra o estado. Cada
fingerprint identifica o estado mais recente, nao um historico completo.
Reenvios sao idempotentes, uma resolucao nao e revertida por uma notificacao
atrasada da mesma ocorrencia e uma ocorrencia com inicio mais recente reabre o
alerta. Se a API ou o banco estiver indisponivel, o webhook retorna erro e o
Alertmanager tenta novamente. O armazenamento do Alertmanager fica no volume
local; a persistencia dos estados da API fica no PostgreSQL.

Para validar a configuracao, a expressao e a entrega real, execute
`npm run validate:observability` e `npm run smoke:observability` com a API de
smoke na porta padrao 3103. Os limites sao demonstrativos e a configuracao nao
substitui roteamento de producao nem escalacao de incidentes.
