# Integracao com o sales-event-project

Este roteiro recebe telemetria real do `sales-event-project` no Collector local
da plataforma e permite investigar a jornada API -> RabbitMQ -> worker.

## Subir a plataforma

```bash
docker compose up -d --wait otel-collector prometheus tempo loki grafana
```

O Compose cria a rede Docker `operational-observability-network`. Os servicos do
`sales-event-project` entram nessa rede para enviar OTLP ao Collector por
`http://otel-collector:4318`.

## Scrapes Prometheus adicionados

A plataforma coleta metricas dos servicos de venda quando eles estao na rede
compartilhada:

| Job                              | Target                    | Labels                                                                  |
| -------------------------------- | ------------------------- | ----------------------------------------------------------------------- |
| `sales-event-api`                | `api:8080`                | `service="sales-event-api"`, `environment="development"`                |
| `sales-event-worker`             | `worker:9091`             | `service="sales-event-worker"`, `environment="development"`             |
| `sales-event-email-retry-worker` | `email-retry-worker:9092` | `service="sales-event-email-retry-worker"`, `environment="development"` |

## Rodar o sales-event-project

No repositorio `sales-event-project`:

```bash
OTEL_ENABLED=true \
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318 \
OTEL_SERVICE_NAMESPACE=portfolio \
docker compose up --build postgres rabbitmq migrate api worker email-retry-worker
```

Use o roteiro do sales em
`docs/observability-platform-integration.md` para criar uma venda com
`X-Correlation-ID` conhecido.

## Consultas manuais

Tempo:

- Pesquise traces com `service.name` igual a `sales-event-api`.
- Abra o trace da venda e confirme spans de API, publish RabbitMQ, consume
  RabbitMQ e worker.

Loki:

```logql
{service_name=~"sales-event-api|sales-event-worker"} | json | correlation_id="corr-demo-sale-001"
```

Prometheus:

```promql
up{job=~"sales-event-api|sales-event-worker|sales-event-email-retry-worker"}
http_requests_total{service="sales-event-api",environment="development"}
worker_messages_processed_total{service="sales-event-worker",environment="development"}
```

Essas consultas devem usar os mesmos nomes de servico que aparecem nos traces e
logs OTLP.
