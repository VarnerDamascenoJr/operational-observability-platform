# Operational Observability Platform

Plataforma de observabilidade operacional que centraliza configuracao de SLOs,
alertas, regras de sampling, correlacao e investigacao de incidentes.

O projeto atua como plano de controle. A coleta pesada de telemetria sera feita
pelo OpenTelemetry Collector e armazenada em Prometheus, Tempo e Loki.

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
npm run dev
```

Verifique a API em `GET http://localhost:3000/health`.

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

O Grafana provisiona automaticamente as fontes Prometheus, Tempo e Loki. O
Collector recebe dados OTLP e encaminha traces para o Tempo, metricas para o
Prometheus e logs para o Loki. A retencao local de traces, logs e metricas e de
24 horas.

Para acompanhar a inicializacao:

```bash
docker compose ps
docker compose logs -f otel-collector prometheus tempo loki grafana
npm run validate:observability
npm run smoke:observability
```

`validate:observability` verifica as configuracoes do Compose, Collector e
Prometheus. `smoke:observability` verifica ingestao OTLP, persistencia de trace
no Tempo, persistencia de log correlacionado no Loki, scrape do Collector pelo
Prometheus e provisionamento das fontes no Grafana.

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
validar a API compilada e em execucao, incluindo o fluxo HTTP real.

## Proximo marco

Instrumentar uma API de demonstracao para produzir metricas, logs e traces
correlacionados para esta stack.
