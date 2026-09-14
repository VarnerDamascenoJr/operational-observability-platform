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

docker compose up -d postgres otel-collector prometheus tempo loki grafana >/dev/null
npm run build >/dev/null
DATABASE_URL="${DATABASE_URL:-postgresql://observability:observability@localhost:5432/observability}" npm run db:migrate >/dev/null

NODE_ENV=production \
  LOG_LEVEL=info \
  OTEL_ENABLED=true \
  OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 \
  DATABASE_URL="${DATABASE_URL:-postgresql://observability:observability@localhost:5432/observability}" \
  PORT="$api_port" \
  HOST=127.0.0.1 \
  node dist/server.js >"$api_log_file" 2>&1 &
api_pid="$!"

for _ in $(seq 1 30); do
  if curl --fail --silent --show-error "$api_base_url/health" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
curl --fail --silent --show-error "$api_base_url/health" >/dev/null

curl --fail --silent --show-error http://localhost:13133/ >/dev/null
curl --fail --silent --show-error --user admin:admin http://localhost:3001/api/datasources |
  jq --exit-status 'map(.uid) | contains(["prometheus", "tempo", "loki"])' >/dev/null
curl --fail --silent --show-error --get \
  --data-urlencode 'query=up{job="otel-collector"}' \
  http://localhost:9090/api/v1/query |
  jq --exit-status '.data.result[] | select(.value[1] == "1")' >/dev/null

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

test "$demo_trace_id" != 'null'
curl --fail --silent --show-error "$api_base_url/metrics" |
  grep 'route="/demo/transactions"' >/dev/null

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
