# Investigacao da jornada de venda

Este roteiro usa o dashboard `Operational Observability - Sales Event Journey`
para responder onde uma venda parou e qual sintoma apareceu.

## Pre-requisitos

1. Suba a plataforma:

```bash
docker compose up -d --wait otel-collector prometheus tempo loki grafana
```

2. No `sales-event-project`, suba o fluxo integrado:

```bash
OTEL_ENABLED=true \
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318 \
OTEL_SERVICE_NAMESPACE=portfolio \
docker compose up --build postgres rabbitmq migrate api worker email-retry-worker
```

3. Abra o Grafana em `http://localhost:3001` com `admin` / `admin`.

## Venda aprovada

1. Crie uma venda com `X-Correlation-ID` conhecido, seguindo o roteiro do
   `sales-event-project`.
2. Confirme o pagamento aprovado pelo webhook assinado.
3. No dashboard, confira:
   - `Vendas aceitas pela API` aumentou.
   - `Pagamentos aprovados e recusados` mostra `APPROVED`.
   - `Outbox por evento, estado e tentativas` mostra `SALE_COMPLETED` publicado.
   - `Publicacoes RabbitMQ por rota e status` mostra `sale.completed` publicado.
   - `Mensagens processadas pelos workers` mostra ack nas filas.
   - `Tickets emitidos` e `Entrega de emails` indicam emissao e tentativa de envio.
4. Cole o `trace_id` no dashboard e use `Abrir trace no Tempo`.
5. Cole o `X-Correlation-ID` em `correlation_id` e use
   `Abrir logs por correlacao no Loki`.

Resultado esperado: o trace mostra spans de API, publish RabbitMQ, consume
RabbitMQ e worker; os logs usam o mesmo `correlation_id`.

## Falha controlada

Use um dos cenarios do `sales-event-project`:

```bash
scripts/run-failure-scenarios.sh duplicate-payment
scripts/run-failure-scenarios.sh email-failure
```

No dashboard:

- Pagamento duplicado aparece em `Pagamentos duplicados idempotentes`.
- Falha de email aparece em `Entrega de emails` com status de falha ou retry.
- Problemas de outbox aparecem em `Outbox por evento, estado e tentativas`.
- Erros HTTP aparecem em `Erros HTTP por rota`.

Para investigar, use sempre a mesma ordem:

1. Identifique o painel que mudou.
2. Filtre por status, fila, rota ou provider.
3. Abra o trace no Tempo pelo `trace_id`.
4. Abra logs correlacionados no Loki pelo `correlation_id`.
5. Compare o sintoma tecnico com a etapa da jornada: venda, pagamento, outbox,
   ticket, email ou check-in.

## Evidencia da demo

Registre:

- `saleId`, `x-correlation-id`, `x-transaction-id` e `trace_id`.
- Print ou export do dashboard com o painel que mudou.
- Link ou consulta Tempo do trace.
- Consulta Loki por `correlation_id`.
- Consulta Prometheus que comprova o contador ou status usado no diagnostico.
