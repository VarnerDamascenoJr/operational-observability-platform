#!/usr/bin/env bash

set -euo pipefail

trace_id='abcdefabcdefabcdefabcdefabcdefab'
span_id='abcdefabcdefabcd'
service_name='observability-smoke-test'
api_service_name='operational-observability-platform'
api_port="${API_PORT:-3103}"
api_base_url="http://127.0.0.1:${api_port}"
api_log_file="$(mktemp)"
start_time=$(date +%s%N)
end_time=$((start_time + 1000000))

cleanup() {
  if [ -n "${api_pid:-}" ]; then
    kill "$api_pid" >/dev/null 2>&1 || true
    wait "$api_pid" >/dev/null 2>&1 || true
  fi
}

trap cleanup EXIT

docker compose up -d --wait postgres otel-collector prometheus tempo loki grafana >/dev/null
npm run build >/dev/null
DATABASE_URL="${DATABASE_URL:-postgresql://observability:observability@localhost:5432/observability}" npm run db:migrate >/dev/null

NODE_ENV=production \
  LOG_LEVEL=info \
  OTEL_ENABLED=true \
  OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 \
  DATABASE_URL="${DATABASE_URL:-postgresql://observability:observability@localhost:5432/observability}" \
  PORT="$api_port" \
  HOST=0.0.0.0 \
  node dist/server.js >"$api_log_file" 2>&1 &
api_pid="$!"

for _ in $(seq 1 30); do
  if curl --fail --silent --show-error "$api_base_url/health" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
curl --fail --silent --show-error "$api_base_url/health" >/dev/null

slo_payload=$(mktemp)
cat >"$slo_payload" <<'JSON'
{
  "project": {
    "slug": "portfolio-observability",
    "name": "Portfolio Observability"
  },
  "service": {
    "slug": "operational-observability-platform",
    "name": "Operational Observability Platform",
    "environment": "smoke",
    "owner": "platform"
  },
  "slug": "smoke-demo-transaction-slo",
  "name": "Smoke demo transaction SLO",
  "description": "SLO demonstrativo validado pelo smoke local.",
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
}
JSON
slo_response=$(curl --fail --silent --show-error \
  --header 'content-type: application/json' \
  --data @"$slo_payload" \
  "$api_base_url/slos")
slo_id=$(printf '%s' "$slo_response" | jq --raw-output '.id')
test "$slo_id" != 'null'

curl --fail --silent --show-error "$api_base_url/slos" |
  jq --exit-status '.slos[] | select(.slug == "smoke-demo-transaction-slo")' >/dev/null

evaluation_payload=$(mktemp)
cat >"$evaluation_payload" <<'JSON'
{
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
}
JSON
curl --fail --silent --show-error \
  --header 'content-type: application/json' \
  --data @"$evaluation_payload" \
  "$api_base_url/slos/$slo_id/evaluations" |
  jq --exit-status '.overallStatus == "breached"' >/dev/null
curl --fail --silent --show-error "$api_base_url/slos/$slo_id/status" |
  jq --exit-status '.overallStatus == "breached"' >/dev/null

curl --fail --silent --show-error http://localhost:13133/ >/dev/null
curl --fail --silent --show-error --user admin:admin http://localhost:3001/api/datasources |
  jq --exit-status 'map(.uid) | contains(["prometheus", "tempo", "loki"])' >/dev/null

for _ in $(seq 1 10); do
  dashboard_uids=$(curl --fail --silent --show-error --user admin:admin     'http://localhost:3001/api/search?type=dash-db' |
    jq --raw-output '[.[].uid] | join(" ")')
  if [[ " $dashboard_uids " == *" oop-service-technical "* && " $dashboard_uids " == *" oop-demo-business "* && " $dashboard_uids " == *" oop-sales-event-journey "* && " $dashboard_uids " == *" oop-optiflow-execution "* ]]; then
    break
  fi
  sleep 1
done

curl --fail --silent --show-error --user admin:admin http://localhost:3001/api/dashboards/uid/oop-service-technical |
  jq --exit-status '.dashboard.title == "Operational Observability - Service Technical"' >/dev/null
curl --fail --silent --show-error --user admin:admin http://localhost:3001/api/dashboards/uid/oop-demo-business |
  jq --exit-status '.dashboard.title == "Operational Observability - Demo Business Transactions"' >/dev/null
curl --fail --silent --show-error --user admin:admin http://localhost:3001/api/dashboards/uid/oop-sales-event-journey |
  jq --exit-status '.dashboard.title == "Operational Observability - Sales Event Journey"' >/dev/null
curl --fail --silent --show-error --user admin:admin http://localhost:3001/api/dashboards/uid/oop-optiflow-execution |
  jq --exit-status '.dashboard.title == "Operational Observability - OptiFlow Execution"' >/dev/null

curl --fail --silent --show-error --get \
  --data-urlencode 'query=up{job="otel-collector"}' \
  http://localhost:9090/api/v1/query |
  jq --exit-status '.data.result[] | select(.value[1] == "1")' >/dev/null

for _ in $(seq 1 10); do
  api_target_count=$(curl --fail --silent --show-error --get \
    --data-urlencode 'query=up{job="observability-api"}' \
    http://localhost:9090/api/v1/query |
    jq '[.data.result[] | select(.value[1] == "1")] | length')
  if [ "$api_target_count" -gt 0 ]; then
    break
  fi
  sleep 3
done

test "${api_target_count:-0}" -gt 0

curl --fail --silent --show-error \
  --header 'Content-Type: application/json' \
  --data @- \
  http://localhost:4318/v1/traces >/dev/null <<EOF
{
  "resourceSpans": [{
    "resource": {
      "attributes": [{
        "key": "service.name",
        "value": { "stringValue": "$service_name" }
      }]
    },
    "scopeSpans": [{
      "scope": { "name": "observability-smoke-test" },
      "spans": [{
        "traceId": "$trace_id",
        "spanId": "$span_id",
        "name": "telemetry-ingestion",
        "kind": 1,
        "startTimeUnixNano": "$start_time",
        "endTimeUnixNano": "$end_time"
      }]
    }]
  }]
}
EOF

for _ in $(seq 1 10); do
  if curl --fail --silent --show-error "http://localhost:3200/api/traces/$trace_id" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
curl --fail --silent --show-error "http://localhost:3200/api/traces/$trace_id" >/dev/null

curl --fail --silent --show-error \
  --header 'Content-Type: application/json' \
  --data @- \
  http://localhost:4318/v1/logs >/dev/null <<EOF
{
  "resourceLogs": [{
    "resource": {
      "attributes": [{
        "key": "service.name",
        "value": { "stringValue": "$service_name" }
      }]
    },
    "scopeLogs": [{
      "scope": { "name": "observability-smoke-test" },
      "logRecords": [{
        "timeUnixNano": "$end_time",
        "traceId": "$trace_id",
        "spanId": "$span_id",
        "severityText": "INFO",
        "body": { "stringValue": "correlated observability smoke log" }
      }]
    }]
  }]
}
EOF

for _ in $(seq 1 10); do
  log_count=$(curl --fail --silent --show-error --get \
    --data-urlencode "query={service_name=\"$service_name\"} | trace_id = \"$trace_id\"" \
    http://localhost:3100/loki/api/v1/query_range |
    jq '.data.result | length')
  if [ "$log_count" -gt 0 ]; then
    break
  fi
  sleep 1
done

test "${log_count:-0}" -gt 0

demo_response=$(curl --fail --silent --show-error \
  --header 'x-correlation-id: smoke-demo-correlation' \
  --header 'x-transaction-id: smoke-demo-transaction' \
  "$api_base_url/demo/transactions?delayMs=10&asyncMs=5")
demo_trace_id=$(printf '%s' "$demo_response" | jq --raw-output '.traceId')

curl --fail --silent --show-error \
  --header 'x-correlation-id: smoke-demo-slow-correlation' \
  --header 'x-transaction-id: smoke-demo-slow-transaction' \
  "$api_base_url/demo/transactions?dependency=slow&delayMs=5&asyncMs=1" >/dev/null

failure_body=$(mktemp)
failure_status=$(curl --silent --show-error \
  --output "$failure_body" \
  --write-out '%{http_code}' \
  --header 'x-correlation-id: smoke-demo-failure-correlation' \
  --header 'x-transaction-id: smoke-demo-failure-transaction' \
  "$api_base_url/demo/transactions?dependency=unavailable&asyncMs=1")
test "$failure_status" = '503'
jq --exit-status '.status == "failed" and .traceId != null' "$failure_body" >/dev/null

test "$demo_trace_id" != 'null'
metrics_body=$(curl --fail --silent --show-error "$api_base_url/metrics")
printf '%s' "$metrics_body" | grep 'route="/demo/transactions"' >/dev/null
printf '%s' "$metrics_body" | grep 'demo_transactions_total' >/dev/null
printf '%s' "$metrics_body" | grep 'outcome="success"' >/dev/null
printf '%s' "$metrics_body" | grep 'outcome="error"' >/dev/null
printf '%s' "$metrics_body" | grep 'dependency_mode="slow"' >/dev/null
printf '%s' "$metrics_body" | grep 'slo_error_budget_consumed_percentage' >/dev/null

for _ in $(seq 1 16); do
  firing_alerts=$(curl --fail --silent --show-error http://localhost:9090/api/v1/alerts)
  if printf '%s' "$firing_alerts" | jq --exit-status '
    ([.data.alerts[] | select(.labels.alertname == "OOPHighHttpErrorRate" and .state == "firing")] | length > 0) and
    ([.data.alerts[] | select(.labels.alertname == "OOPHighHttpLatency" and .state == "firing")] | length > 0) and
    ([.data.alerts[] | select(.labels.alertname == "OOPSloErrorBudgetBurn" and .state == "firing")] | length > 0)
  ' >/dev/null; then
    break
  fi
  sleep 5
done

printf '%s' "${firing_alerts:-}" | jq --exit-status '
  ([.data.alerts[] | select(.labels.alertname == "OOPHighHttpErrorRate" and .state == "firing")] | length > 0) and
  ([.data.alerts[] | select(.labels.alertname == "OOPHighHttpLatency" and .state == "firing")] | length > 0) and
  ([.data.alerts[] | select(.labels.alertname == "OOPSloErrorBudgetBurn" and .state == "firing")] | length > 0)
' >/dev/null

for _ in $(seq 1 10); do
  if curl --fail --silent --show-error "http://localhost:3200/api/traces/$demo_trace_id" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
curl --fail --silent --show-error "http://localhost:3200/api/traces/$demo_trace_id" >/dev/null

for _ in $(seq 1 10); do
  api_log_count=$(curl --fail --silent --show-error --get \
    --data-urlencode "query={service_name=\"$api_service_name\"} | trace_id = \"$demo_trace_id\"" \
    http://localhost:3100/loki/api/v1/query_range |
    jq '.data.result | length')
  if [ "$api_log_count" -gt 0 ]; then
    break
  fi
  sleep 1
done

test "${api_log_count:-0}" -gt 0
