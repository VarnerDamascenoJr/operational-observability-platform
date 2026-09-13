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
