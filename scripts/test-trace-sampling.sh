#!/usr/bin/env bash
set -euo pipefail

# Exercise the configured Collector and Tempo, using a fresh set of trace IDs.
test_dir=$(mktemp -d)
trap 'rm -rf "$test_dir"' EXIT
start=$(date +%s%N)
fast_end=$((start + 1000000))
slow_end=$((start + 1000000000))
for _ in $(seq 0 219); do openssl rand -hex 16; done > "$test_dir/ids"
first_id=$(sed -n '1p' "$test_dir/ids")
last_required_id=$(sed -n '20p' "$test_dir/ids")

jq -n --rawfile ids "$test_dir/ids" --arg start "$start" --arg fast "$fast_end" --arg slow "$slow_end" '
  {resourceSpans: [{resource: {attributes: [{key: "service.name", value: {stringValue: "sampling-smoke"}}]},
    scopeSpans: [{spans: [($ids | split("\n") | .[:-1] | to_entries[]) |
      {traceId: .value, spanId: "abcdefabcdefabcd", name: "sampling-smoke", kind: 1,
       startTimeUnixNano: $start, endTimeUnixNano: (if .key >= 10 and .key < 20 then $slow else $fast end)} +
      (if .key < 10 then {status: {code: 2}} else {} end)]}]}]}' > "$test_dir/payload"
curl --fail --silent --show-error -H 'Content-Type: application/json' \
  --data @"$test_dir/payload" http://localhost:4318/v1/traces >/dev/null

# Sampling waits five seconds, then the exporter batches the accepted traces.
for _ in $(seq 1 20); do
  if curl --fail --silent "http://localhost:3200/api/traces/${first_id}" >/dev/null &&
     curl --fail --silent "http://localhost:3200/api/traces/${last_required_id}" >/dev/null; then
    break
  fi
  sleep 1
done
while IFS= read -r id; do
  curl --fail --silent --show-error "http://localhost:3200/api/traces/${id}" >/dev/null
done < <(head -n 20 "$test_dir/ids")

kept=0
dropped=0
while IFS= read -r id; do
  code=$(curl --silent --show-error -o /dev/null -w '%{http_code}' "http://localhost:3200/api/traces/${id}")
  case "$code" in
    200) kept=$((kept + 1)) ;;
    404) dropped=$((dropped + 1)) ;;
    *) echo "Unexpected Tempo response $code for trace $id" >&2; exit 1 ;;
  esac
done < <(tail -n +21 "$test_dir/ids")
if (( kept == 0 || dropped == 0 )); then
  echo "Expected both kept and dropped healthy traces; kept=$kept dropped=$dropped" >&2
  exit 1
fi
printf 'Trace sampling: 10 error and 10 slow traces retained; healthy kept=%s dropped=%s\n' "$kept" "$dropped"
