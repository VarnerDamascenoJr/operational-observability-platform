#!/usr/bin/env bash

set -euo pipefail

trace_id='abcdefabcdefabcdefabcdefabcdefab'
span_id='abcdefabcdefabcd'
service_name='observability-smoke-test'
start_time=$(date +%s%N)
end_time=$((start_time + 1000000))

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
  if curl --fail --silent --show-error "http://localhost:3200/api/traces/$trace_id" >/dev/null; then
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
