#!/usr/bin/env bash
set -Eeuo pipefail

cd "$(dirname "$0")/.."
work_dir=$(mktemp -d)
project="oop-outage-$(basename "$work_dir" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9' | tail -c 12)"
read -r OUTAGE_OTLP_PORT OUTAGE_HEALTH_PORT < <(node --input-type=module -e '
  import { createServer } from "node:net";
  const servers = [createServer(), createServer()];
  await Promise.all(servers.map(server => new Promise(resolve => server.listen(0, "127.0.0.1", resolve))));
  console.log(servers.map(server => server.address().port).join(" "));
  await Promise.all(servers.map(server => new Promise(resolve => server.close(resolve))));
')
export OUTAGE_OTLP_PORT OUTAGE_HEALTH_PORT
compose=(docker compose -p "$project" -f tests/integration/collector-outage.compose.yml)
server_pid=''
cleanup() {
  local result=$?
  trap - EXIT
  if (( result != 0 )); then
    echo 'Collector outage test failed; isolated service and API logs follow.' >&2
    "${compose[@]}" logs --no-color >&2 || true
    [[ ! -f "$work_dir/api.log" ]] || cat "$work_dir/api.log" >&2
  fi
  if [[ -n "$server_pid" ]]; then
    kill "$server_pid" 2>/dev/null || true
    wait "$server_pid" 2>/dev/null || true
  fi
  "${compose[@]}" down --remove-orphans >/dev/null 2>&1 || true
  rm -rf "$work_dir"
  exit "$result"
}
trap cleanup EXIT

wait_url() {
  local url="$1"
  for _ in $(seq 1 40); do
    if curl --fail --silent --max-time 2 "$url" >/dev/null; then return 0; fi
    sleep 1
  done
  echo "Timed out waiting for $url" >&2
  return 1
}
wait_trace() {
  local trace_id="$1"
  wait_url "$tempo_url/api/traces/$trace_id"
}
wait_log() {
  local trace_id="$1" count
  for _ in $(seq 1 40); do
    if count=$(curl --fail --silent --max-time 3 --get \
      --data-urlencode "query={service_name=\"collector-outage-test\"} | trace_id = \"$trace_id\"" \
      "$loki_url/loki/api/v1/query_range" | jq -er '.data.result | length') && (( count > 0 )); then
      return 0
    fi
    sleep 1
  done
  echo "Timed out waiting for log $trace_id" >&2
  return 1
}

npm run build >/dev/null
"${compose[@]}" up -d --wait
collector_address=$("${compose[@]}" port otel-collector 4318)
health_address=$("${compose[@]}" port otel-collector 13133)
tempo_url="http://$("${compose[@]}" port tempo 3200)"
loki_url="http://$("${compose[@]}" port loki 3100)"
wait_url "http://$health_address/"
TEST_OTLP_ENDPOINT="http://$collector_address" TEST_ADDRESS_FILE="$work_dir/address" \
  NODE_ENV=production node tests/integration/collector-outage-server.mjs >"$work_dir/api.log" 2>&1 &
server_pid=$!
for _ in $(seq 1 30); do
  [[ ! -s "$work_dir/address" ]] || break
  kill -0 "$server_pid" 2>/dev/null || { echo 'Test API exited during startup.' >&2; exit 1; }
  sleep 1
done
api_url=$(cat "$work_dir/address")

# Slow traces match the 100% latency policy rather than the probabilistic policy.
before=$(curl --fail --silent --show-error --max-time 5 "$api_url/demo/transactions?dependency=slow&asyncMs=1")
before_id=$(jq -er '.traceId' <<<"$before")
wait_trace "$before_id"
wait_log "$before_id"

"${compose[@]}" stop otel-collector
if curl --fail --silent --max-time 2 "http://$health_address/" >/dev/null 2>&1; then
  echo 'Collector is still reachable after stop.' >&2
  exit 1
fi
during=$(curl --fail --silent --show-error --max-time 5 "$api_url/demo/transactions?dependency=slow&asyncMs=1")
during_id=$(jq -er 'select(.status == "succeeded") | .traceId' <<<"$during")
# Application logs remain available even when OTLP export fails.
warning_seen=0
for _ in $(seq 1 10); do
  if jq -s -e --arg id "$during_id" 'any(.[]; .trace_id == $id and .msg == "demo telemetry export failed")' "$work_dir/api.log" >/dev/null 2>&1; then
    warning_seen=1
    break
  fi
  sleep 1
done
[[ "$warning_seen" = 1 ]] || { echo 'Missing export failure warning.' >&2; exit 1; }
failure_code=$(curl --silent --show-error --max-time 5 -o "$work_dir/failure.json" -w '%{http_code}' \
  "$api_url/demo/transactions?dependency=unavailable&asyncMs=1")
[[ "$failure_code" = 503 ]]
jq -e '.status == "failed"' "$work_dir/failure.json" >/dev/null

"${compose[@]}" start otel-collector
if [[ $("${compose[@]}" port otel-collector 4318) != "$collector_address" ]]; then
  echo 'Collector port changed on restart; cannot test the same client endpoint.' >&2
  exit 1
fi
wait_url "http://$health_address/"
after=$(curl --fail --silent --show-error --max-time 5 "$api_url/demo/transactions?dependency=slow&asyncMs=1")
after_id=$(jq -er 'select(.status == "succeeded") | .traceId' <<<"$after")
wait_trace "$after_id"
wait_log "$after_id"
# The demo exporter has no retry queue; the failed export is not replayed.
status=$(curl --silent --show-error -o /dev/null -w '%{http_code}' "$tempo_url/api/traces/$during_id")
[[ "$status" = 404 ]] || { echo "Expected missing outage trace, received $status." >&2; exit 1; }
printf 'Collector outage: API remained available; new traces and logs recovered; outage trace was not replayed.\n'
