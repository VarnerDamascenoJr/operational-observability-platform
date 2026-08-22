# Operational Observability Platform

Plataforma de observabilidade operacional que centraliza configuracao de SLOs,
alertas, regras de sampling, correlacao e investigacao de incidentes.

O projeto atua como plano de controle. A coleta pesada de telemetria sera feita
pelo OpenTelemetry Collector e armazenada em Prometheus, Tempo e Loki.

## Stack inicial

- Node.js 22, TypeScript e Fastify
- PostgreSQL para configuracao e estado operacional
- Docker Compose para ambiente local
- ESLint, Prettier e Vitest

## Executar localmente

```bash
cp .env.example .env
npm install
docker compose up -d postgres
npm run dev
```

Verifique a API em `GET http://localhost:3000/health`.

## Proximo marco

Adicionar OpenTelemetry Collector, Prometheus, Tempo, Loki e Grafana ao ambiente
local e instrumentar uma API de demonstracao para produzir telemetria correlacionada.
