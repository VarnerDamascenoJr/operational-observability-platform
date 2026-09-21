# Operational Observability Platform

[![Continuous Integration](https://github.com/VarnerDamascenoJr/operational-observability-platform/actions/workflows/ci.yml/badge.svg)](https://github.com/VarnerDamascenoJr/operational-observability-platform/actions/workflows/ci.yml)

Plataforma de observabilidade operacional que centraliza configuracao de SLOs,
alertas, regras de sampling, correlacao e investigacao de incidentes.

O projeto atua como plano de controle. A coleta pesada de telemetria sera feita
pelo OpenTelemetry Collector e armazenada em Prometheus, Tempo e Loki.

## Convencoes de correlacao

Este projeto adota as convencoes compartilhadas do portfolio para
`X-Request-ID`, `X-Correlation-ID`, `X-Transaction-ID`, logs, traces, metricas e
investigacao. A fonte de verdade esta no documento
[`portfolio-correlation-conventions.md`](https://github.com/VarnerDamascenoJr/OptiFlow/blob/main/docs/portfolio-correlation-conventions.md).

## Stack inicial

- Node.js 22, TypeScript e Fastify
- PostgreSQL para configuracao e estado operacional
- OpenTelemetry Collector, Prometheus, Tempo, Loki e Grafana
- Docker Compose para ambiente local e reproduzivel
- ESLint, Prettier e Vitest

## Executar localmente

```bash
cp .env.example .env
npm install
docker compose up -d
npm run db:migrate
npm run dev
```

O servidor tambem valida/aplica migrations no startup antes de aceitar trafego.
Verifique a API em `GET http://localhost:3000/health`; a resposta informa o
estado da API, do PostgreSQL, das migrations e das tabelas iniciais do schema
`control_plane`.

Cada resposta HTTP inclui `x-request-id` e `x-transaction-id`. Valores validos
recebidos nesses headers sao propagados; valores ausentes ou inseguros sao
substituidos por UUIDs. Consulte `docs/correlation.md` para o contrato completo
de IDs e logs estruturados.

O endpoint `GET /demo/transactions` simula uma transacao operacional com etapa
assincrona, dependencia externa lenta ou indisponivel, metricas RED, logs
correlacionados e traces/logs OTLP quando `OTEL_ENABLED=true`. Exemplos:

```bash
curl 'http://localhost:3000/demo/transactions?delayMs=50&asyncMs=10'
curl 'http://localhost:3000/demo/transactions?dependency=unavailable'
```

A API de SLO permite configurar objetivos por servico, avaliar janelas de
`availability` e `latency` e consultar consumo de error budget. Consulte
[`docs/slo-error-budget.md`](docs/slo-error-budget.md) para exemplos completos.

As regras Prometheus de alerta baseadas em sintomas cobrem erro HTTP alto,
latencia HTTP alta e consumo de error budget. O runbook local esta em
[`docs/symptom-alerts.md`](docs/symptom-alerts.md).

A API de incidentes permite abrir, investigar e encerrar incidentes associados a
servico, alerta e SLO. Ela preserva evidencias, hipoteses e linha do tempo da
resposta. Consulte [`docs/incident-investigation.md`](docs/incident-investigation.md).

## Banco de dados

As migrations SQL ficam em `migrations/` e seguem o formato
`NNNN_descricao.sql`. Execute `npm run db:migrate` depois de iniciar o
PostgreSQL. O executor aplica cada migration em uma transacao, impede execucoes
concorrentes e recusa alteracoes em arquivos que ja tenham sido aplicados.

As migrations criam o schema `control_plane` e as tabelas iniciais para
projetos, servicos e configuracoes operacionais. As migrations aplicadas sao
registradas em `public.schema_migrations`, com checksum para detectar alteracoes
em arquivos ja aplicados.

## Observabilidade local

| Componente          | URL                     | Uso                              |
| ------------------- | ----------------------- | -------------------------------- |
| Grafana             | http://localhost:3001   | Explore, dashboards e correlacao |
| Prometheus          | http://localhost:9090   | Metricas e regras de alerta      |
| Tempo               | http://localhost:3200   | Traces distribuidos              |
| Loki                | http://localhost:3100   | Logs estruturados                |
| Collector OTLP gRPC | `localhost:4317`        | Ingestao de telemetria           |
| Collector OTLP HTTP | `http://localhost:4318` | Ingestao de telemetria           |

O login local do Grafana e `admin` / `admin`. Essas credenciais sao somente
para desenvolvimento local. Todas as portas sao vinculadas a `127.0.0.1` e nao
ficam acessiveis por outras maquinas da rede.

O Grafana provisiona automaticamente as fontes Prometheus, Tempo e Loki e os
dashboards `Operational Observability - Service Technical` e
`Operational Observability - Demo Business Transactions`, alem do dashboard
`Operational Observability - Sales Event Journey` para acompanhar venda,
pagamento, outbox, tickets, email e check-in, e do dashboard
`Operational Observability - OptiFlow Execution` para acompanhar execucoes de
otimizacao. O Collector recebe dados OTLP e encaminha traces para o Tempo,
metricas para o Prometheus e logs para o Loki. A retencao local de traces, logs
e metricas e de 24 horas.

O roteiro manual de investigacao esta em
[`docs/dashboard-investigation.md`](docs/dashboard-investigation.md). Ele mostra
como partir de throughput, erro ou latencia, abrir traces no Tempo e consultar
logs correlacionados no Loki pelo mesmo `trace_id`.

Para receber traces, logs e metricas reais do `sales-event-project`, use
[`docs/sales-event-integration.md`](docs/sales-event-integration.md). A
plataforma cria a rede compartilhada `operational-observability-network` e
coleta os targets `sales-event-api`, `sales-event-worker` e
`sales-event-email-retry-worker`. O roteiro de investigacao do dashboard de
vendas esta em
[`docs/sales-journey-investigation.md`](docs/sales-journey-investigation.md).

Para receber metricas reais do `OptiFlow`, use
[`docs/optiflow-execution-metrics.md`](docs/optiflow-execution-metrics.md). O
Prometheus coleta o target `optiflow-api` em `host.docker.internal:3000`.

Para acompanhar a inicializacao:

```bash
docker compose ps
docker compose logs -f otel-collector prometheus tempo loki grafana
npm run validate:observability
npm run smoke:observability
```

`validate:observability` verifica as configuracoes do Compose, Collector,
Prometheus, regras de alerta e dashboards provisionados. `smoke:observability`
verifica ingestao OTLP, persistencia de trace no Tempo, persistencia de log
correlacionado no Loki, scrape do Collector e da API pelo Prometheus,
provisionamento das fontes e dashboards no Grafana, chamadas reais ao endpoint
`/demo/transactions`, metricas de sucesso/falha/degradacao, SLO demonstrativo e
alertas de erro, latencia e error budget disparados.

## Qualidade

```bash
npm run lint
npm run format
npm run test:unit
npm run test:coverage
npm run test:e2e
npm run build
npm run check
```

Os testes unitarios usam Vitest. Os testes end-to-end usam Playwright para
validar a API compilada e em execucao, incluindo o fluxo HTTP real e o health
check com PostgreSQL disponivel. O comando `npm run test:e2e` sobe o servico
`postgres` do Docker Compose e aplica migrations antes de iniciar a API.

## Proximo marco

Conectar traces reais do `sales-event-project` na plataforma e iniciar a
narrativa integrada entre venda, alerta, incidente e investigacao.
