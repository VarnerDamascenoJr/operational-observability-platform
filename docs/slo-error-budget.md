# SLO, SLI e error budget

A plataforma modela SLOs como objetivos versionados por servico observado. Cada
SLO pertence a um projeto e servico do `control_plane`, possui uma janela de
avaliacao em dias e contem um ou mais SLIs.

Os SLIs suportados nesta etapa sao:

- `availability`: proporcao de eventos bem-sucedidos sobre eventos validos.
- `latency`: proporcao de eventos dentro do limite de latencia configurado.

O calculo nao consulta Prometheus diretamente nesta etapa. A API recebe contagens
de eventos da janela avaliada. Isso torna o calculo reproduzivel em testes e
prepara a base para conectar consultas PromQL nas proximas tarefas.

## Criar ou atualizar um SLO

```bash
curl --request POST 'http://localhost:3000/slos' \
  --header 'content-type: application/json' \
  --data '{
    "project": {
      "slug": "portfolio-observability",
      "name": "Portfolio Observability"
    },
    "service": {
      "slug": "operational-observability-platform",
      "name": "Operational Observability Platform",
      "environment": "development",
      "owner": "platform"
    },
    "slug": "demo-transaction-slo",
    "name": "Demo transaction SLO",
    "description": "SLO demonstrativo para disponibilidade e latencia.",
    "windowDays": 7,
    "objectives": [
      {
        "type": "availability",
        "targetPercentage": 99
      },
      {
        "type": "latency",
        "targetPercentage": 95,
        "latencyThresholdMilliseconds": 500
      }
    ]
  }'
```

A operacao e idempotente por `service` e `slug`: uma nova chamada com o mesmo
slug atualiza nome, descricao, janela e objetivos.

## Listar SLOs

```bash
curl 'http://localhost:3000/slos'
```

## Avaliar uma janela

```bash
curl --request POST 'http://localhost:3000/slos/<slo-id>/evaluations' \
  --header 'content-type: application/json' \
  --data '{
    "windowStartedAt": "2026-09-13T00:00:00.000Z",
    "windowEndedAt": "2026-09-14T00:00:00.000Z",
    "indicators": {
      "availability": {
        "totalEvents": 1000,
        "goodEvents": 995
      },
      "latency": {
        "totalEvents": 1000,
        "goodEvents": 940
      }
    },
    "source": {
      "kind": "fixture",
      "query": "fixtures/slo/demo-transaction-windows.json",
      "period": "1d"
    }
  }'
```

Para cada SLI, a plataforma calcula:

```text
observed_percentage = good_events / total_events * 100
bad_events = total_events - good_events
error_budget_total_events = total_events * (1 - target_percentage / 100)
error_budget_consumed_percentage = bad_events / error_budget_total_events * 100
error_budget_remaining_percentage = 100 - error_budget_consumed_percentage
```

`source.kind` identifica se as contagens vieram de entrada `manual`, fixture
temporal (`fixture`) ou consulta Prometheus (`prometheus`). `source.query` e
`source.period` preservam a referencia reproduzivel que gerou a janela.

Se `totalEvents` for zero, o status do SLI fica `no_data` e percentuais de
observacao e error budget ficam nulos. Se o percentual observado ficar abaixo do
alvo, o status fica `breached`.

## Consultar estado atual

```bash
curl 'http://localhost:3000/slos/<slo-id>/status'
```

O estado geral do SLO e:

- `breached` quando qualquer SLI esta violado;
- `no_data` quando nao ha janela avaliada ou algum SLI ainda nao possui dados;
- `ok` quando todos os SLIs avaliados cumprem seus alvos.

## Consultar janelas rolantes

```bash
curl 'http://localhost:3000/slos/<slo-id>/rolling-windows?limit=14'
```

A resposta retorna, para cada SLI, as ultimas janelas avaliadas em ordem
cronologica e um resumo estatistico para acompanhar tendencia operacional:

- `averageObservedPercentage`: media dos percentuais observados nas janelas com
  dados;
- `minObservedPercentage`: pior percentual observado na serie;
- `maxErrorBudgetConsumedPercentage`: maior consumo de error budget observado;
- `breachedWindows` e `noDataWindows`: quantidade de janelas violadas ou sem
  dados;
- `totalEvents`, `totalGoodEvents` e `totalBadEvents`: volume acumulado da serie;
- `source`: origem reproduzivel usada para calcular cada janela.

O `overallStatus` dessa consulta considera o status mais recente de cada SLI.
Assim, a plataforma separa duas leituras: o estado atual do SLO e a trajetoria
recente que levou ate ele.

## Consultar burn rate multi-janela

```bash
curl 'http://localhost:3000/slos/<slo-id>/burn-rate?shortWindows=1&longWindows=6'
```

Burn rate mede a velocidade de consumo do error budget em relacao ao ritmo
esperado para o horizonte do SLO. Um burn rate `1` significa que a janela esta
consumindo exatamente o orçamento proporcional esperado; `4` significa consumo
quatro vezes mais rapido.

A API agrega as ultimas janelas avaliadas de cada SLI em dois recortes:

- `shortWindow`: janela curta, sensivel a degradacao recente;
- `longWindow`: janela longa, usada para confirmar se a degradacao e sustentada.

A severidade combina os dois recortes:

- `page`: `shortWindow.burnRate >= 4` e `longWindow.burnRate >= 2`;
- `warning`: apenas um dos dois recortes passou do limiar de escalacao;
- `watch`: algum recorte esta acima de `1`, mas ainda abaixo da escalacao;
- `ok`: consumo dentro do ritmo esperado;
- `no_data`: nao ha eventos avaliados suficientes.

O endpoint tambem informa, por janela, eventos totais, eventos bons, eventos
ruins, percentual observado, percentual de error budget consumido, percentual de
budget esperado para o tempo coberto e a interpretacao operacional.
