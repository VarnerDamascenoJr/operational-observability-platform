# Metricas de execucao do OptiFlow

A plataforma pode coletar o endpoint Prometheus do `OptiFlow` para acompanhar
execucoes de otimizacao como operacao observavel.

## Pre-requisitos

No repositorio `OptiFlow`, suba a API local:

```bash
nvm use
OPTIFLOW_API_HOST=0.0.0.0 \
OPTIFLOW_SERVICE_NAME=optiflow-api \
OPTIFLOW_ENVIRONMENT=local \
npm run api
```

Na plataforma, o Prometheus ja possui o target `optiflow-api` apontando para:

```text
host.docker.internal:3000/metrics
```

## Dashboard

O Grafana provisiona o dashboard
`Operational Observability - OptiFlow Execution`, com paineis para:

- execucoes por status e estrategia;
- duracao da execucao;
- custo do plano;
- distancia;
- atraso;
- pedidos nao alocados;
- profundidade da fila local;
- custo por estrategia.

Os paineis usam labels de baixa cardinalidade (`service`, `environment`,
`strategy`, `status` e `scenario_id`). IDs de execucao e correlacao devem ser
consultados nos logs JSON do `OptiFlow`.

## Smoke manual

Com a API do `OptiFlow` e a stack da plataforma rodando:

```bash
curl http://localhost:3000/metrics | grep optiflow_optimization_runs_total
curl --get --data-urlencode 'query=up{job="optiflow-api"}' \
  http://localhost:9090/api/v1/query
```

Abra <http://localhost:3001> com `admin` / `admin` e acesse
`Operational Observability - OptiFlow Execution`.
