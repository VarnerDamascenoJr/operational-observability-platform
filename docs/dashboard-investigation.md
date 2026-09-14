# Investigacao pelos dashboards locais

Use este roteiro para demonstrar a P2.4 com a stack local. Ele parte de uma
transacao operacional simulada e mostra como sair de sintoma tecnico para impacto
de negocio, trace e logs correlacionados.

## Preparar a stack

```bash
docker compose up -d postgres otel-collector prometheus tempo loki grafana
npm run db:migrate
OTEL_ENABLED=true OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 npm run dev
```

Em outra janela, gere telemetria para os tres caminhos principais:

```bash
curl 'http://localhost:3000/demo/transactions?delayMs=10&asyncMs=5'
curl 'http://localhost:3000/demo/transactions?dependency=slow&delayMs=5&asyncMs=1'
curl -i 'http://localhost:3000/demo/transactions?dependency=unavailable&asyncMs=1'
```

O endpoint retorna `traceId`, `traceparent`, `correlationId` e `transactionId`.
Guarde um `traceId` para navegar entre Grafana, Tempo e Loki.

## Dashboard tecnico

Abra o Grafana local em <http://localhost:3001> com `admin` / `admin` e acesse
`Operational Observability - Service Technical`.

1. Ajuste o periodo para os ultimos 30 minutos ou para a janela do teste.
2. Filtre `service` por `operational-observability-platform`.
3. Filtre `environment` conforme a execucao local.
4. Use `Throughput por rota`, `Erros 5xx por rota`, `Latencia media por rota` e
   `Taxa de erro HTTP` para identificar o sintoma.
5. Quando houver erro ou latencia, copie o `traceId` retornado pela API ou visto
   nos logs e cole na variavel `trace_id`.
6. Use o link `Abrir Explore do Tempo` para abrir o trace no Tempo.

## Dashboard de negocio

Abra `Operational Observability - Demo Business Transactions`.

1. Use os mesmos filtros de `service`, `environment` e periodo.
2. Confira `Transacoes por resultado` para ver sucesso e falha.
3. Confira `Degradacao` para quantificar chamadas com dependencia lenta.
4. Use `Duracao media da transacao` para diferenciar latencia normal e degradada.
5. Use `Logs da transacao demo` para ver logs estruturados com `operation`,
   `outcome`, `dependency_mode`, `trace_id`, `correlation_id` e
   `transaction_id`.

## Navegacao entre trace e logs

A fonte Tempo provisionada aponta para Loki usando `tracesToLogsV2`. Ao abrir um
trace no Tempo, use a acao de logs correlacionados para consultar Loki com o
mesmo `trace_id`. Quando partir diretamente do dashboard, use o link
`Abrir logs correlacionados no Loki` depois de preencher a variavel `trace_id`.

A investigacao esperada e:

```text
aumento de erro ou latencia -> dashboard tecnico -> trace no Tempo -> logs no Loki
impacto de negocio -> dashboard de negocio -> trace_id da transacao -> logs correlacionados
```
