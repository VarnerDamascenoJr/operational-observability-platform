#!/usr/bin/env bash
set -Eeuo pipefail

cd "$(dirname "$0")/.."
work_dir=$(mktemp -d)
project="oop-pg-outage-$(basename "$work_dir" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9' | tail -c 12)"
read -r OUTAGE_POSTGRES_PORT OUTAGE_API_PORT < <(node --input-type=module -e '
  import { createServer } from "node:net";
  const servers = [createServer(), createServer()];
  await Promise.all(servers.map(server => new Promise(resolve => server.listen(0, "127.0.0.1", resolve))));
  console.log(servers.map(server => server.address().port).join(" "));
  await Promise.all(servers.map(server => new Promise(resolve => server.close(resolve))));
')
export OUTAGE_POSTGRES_PORT
compose=(docker compose -p "$project" -f tests/integration/postgres-outage.compose.yml)
database_url="postgresql://outage_test:outage_test@127.0.0.1:$OUTAGE_POSTGRES_PORT/outage_test"
api_url="http://127.0.0.1:$OUTAGE_API_PORT"
api_pid=''
cleanup() {
  local result=$?
  trap - EXIT
  if (( result != 0 )); then
    echo 'PostgreSQL outage test failed; isolated service and API logs follow.' >&2
    "${compose[@]}" logs --no-color >&2 || true
    [[ ! -f "$work_dir/api.log" ]] || cat "$work_dir/api.log" >&2
    [[ ! -f "$work_dir/startup.log" ]] || cat "$work_dir/startup.log" >&2
  fi
  if [[ -n "$api_pid" ]]; then
    kill "$api_pid" 2>/dev/null || true
    wait "$api_pid" 2>/dev/null || true
  fi
  # Only this uniquely named test project and its disposable volume are removed.
  "${compose[@]}" down --volumes --remove-orphans >/dev/null 2>&1 || true
  rm -rf "$work_dir"
  exit "$result"
}
trap cleanup EXIT

http_status() {
  curl --silent --show-error --max-time 8 -o "$work_dir/response.json" -w '%{http_code}' "$@"
}
wait_healthy() {
  local code
  for _ in $(seq 1 40); do
    code=$(http_status "$api_url/health" 2>/dev/null) || code=000
    if [[ "$code" = 200 ]] && jq -e '.status == "ok" and .services.postgres.status == "ok"' "$work_dir/response.json" >/dev/null; then
      return 0
    fi
    kill -0 "$api_pid" 2>/dev/null || { echo 'API exited unexpectedly.' >&2; return 1; }
    sleep 1
  done
  echo 'Timed out waiting for PostgreSQL and API health.' >&2
  return 1
}

npm run build >/dev/null
"${compose[@]}" up -d --wait
DATABASE_URL="$database_url" PORT="$OUTAGE_API_PORT" HOST=127.0.0.1 \
  NODE_ENV=production OTEL_ENABLED=false node dist/server.js >"$work_dir/api.log" 2>&1 &
api_pid=$!
wait_healthy
initial=$(curl --fail --silent --show-error --max-time 8 "$api_url/sampling/policy")
revision=$(jq -er '.policy.revision' <<<"$initial")
payload=$(jq -n --argjson revision "$revision" '{revision:$revision,latencyThresholdMs:750,healthySamplingPercentage:25}')
saved=$(curl --fail --silent --show-error --max-time 8 -X PUT -H 'content-type: application/json' --data "$payload" "$api_url/sampling/policy")
saved_policy=$(jq -cS '.policy' <<<"$saved")
revision=$(jq -er '.policy.revision' <<<"$saved")

"${compose[@]}" stop postgres
kill -0 "$api_pid" 2>/dev/null || { echo 'API exited when PostgreSQL stopped.' >&2; exit 1; }
idle_warning=0
for _ in $(seq 1 10); do
  if jq -s -e 'any(.[]; .msg == "PostgreSQL idle connection failed")' "$work_dir/api.log" >/dev/null 2>&1; then
    idle_warning=1
    break
  fi
  kill -0 "$api_pid" 2>/dev/null || { echo 'API exited after idle pool error.' >&2; exit 1; }
  sleep 1
done
[[ "$idle_warning" = 1 ]] || { echo 'Missing idle pool error warning.' >&2; exit 1; }
code=$(http_status "$api_url/health")
[[ "$code" = 503 ]]
jq -e '.status == "degraded" and .services.api.status == "ok" and .services.postgres.status == "error"' "$work_dir/response.json" >/dev/null
code=$(http_status "$api_url/sampling/policy")
[[ "$code" = 500 ]]
failed_payload=$(jq -n --argjson revision "$revision" '{revision:$revision,latencyThresholdMs:1000,healthySamplingPercentage:30}')
code=$(http_status -X PUT -H 'content-type: application/json' --data "$failed_payload" "$api_url/sampling/policy")
[[ "$code" = 500 ]]
code=$(http_status "$api_url/demo/transactions?asyncMs=1")
[[ "$code" = 200 ]]
jq -e '.status == "succeeded"' "$work_dir/response.json" >/dev/null
curl --fail --silent --show-error --max-time 8 "$api_url/metrics" > "$work_dir/metrics"
grep -q '^http_requests_total{' "$work_dir/metrics"

# A fresh API cannot start until migrations can reach PostgreSQL.
set +e
DATABASE_URL="$database_url" PORT=0 HOST=127.0.0.1 NODE_ENV=production OTEL_ENABLED=false \
  timeout 15s node dist/server.js >"$work_dir/startup.log" 2>&1
startup_result=$?
set -e
[[ "$startup_result" = 1 ]] || { echo "Expected startup to fail, got $startup_result." >&2; exit 1; }
if grep -q 'Server listening' "$work_dir/startup.log"; then
  echo 'API accepted traffic without PostgreSQL at startup.' >&2
  exit 1
fi

"${compose[@]}" start postgres
wait_healthy
recovered=$(curl --fail --silent --show-error --max-time 8 "$api_url/sampling/policy")
[[ $(jq -cS '.policy' <<<"$recovered") = "$saved_policy" ]] || { echo 'Saved policy changed during outage.' >&2; exit 1; }
updated=$(curl --fail --silent --show-error --max-time 8 -X PUT -H 'content-type: application/json' --data "$failed_payload" "$api_url/sampling/policy")
jq -e --argjson expected "$((revision + 1))" '.policy.revision == $expected and .policy.latencyThresholdMs == 1000 and .policy.healthySamplingPercentage == 30' <<<"$updated" >/dev/null
kill -0 "$api_pid" 2>/dev/null
printf 'PostgreSQL outage: health degraded, database requests failed, demo remained available, and data and writes recovered.\n'
