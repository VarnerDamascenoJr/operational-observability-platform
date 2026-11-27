#!/usr/bin/env bash
set -euo pipefail

project_dir=$(cd "$(dirname "$0")/.." && pwd)
cd "$project_dir"
mkdir -p .local/sampling
exec 9>.local/sampling/apply.lock
flock -n 9 || { echo 'Another sampling apply is in progress.' >&2; exit 1; }
api_url="${SAMPLING_API_URL:-http://127.0.0.1:3000}"
policy=$(curl --fail --silent --show-error --connect-timeout 3 --max-time 10 "$api_url/sampling/policy")
printf '%s' "$policy" | jq -e '
  .policy | (.revision | type == "number" and floor == . and . >= 1) and
  (.latencyThresholdMs | type == "number" and floor == . and . >= 1 and . <= 3600000) and
  (.healthySamplingPercentage | type == "number" and floor == . and . >= 0 and . <= 100)
' >/dev/null
revision=$(jq -r '.policy.revision' <<<"$policy")
config=$(mktemp "$project_dir/.local/sampling/policy-${revision}.XXXXXX.json")
compose=$(mktemp "$project_dir/.local/sampling/compose-${revision}.XXXXXX.json")
jq '{processors: {tail_sampling: {policies: [
  {name: "errors", type: "status_code", status_code: {status_codes: ["ERROR"]}},
  {name: "slow", type: "latency", latency: {threshold_ms: .policy.latencyThresholdMs}},
  {name: "healthy", type: "probabilistic", probabilistic: {sampling_percentage: .policy.healthySamplingPercentage}}
]}}}' <<<"$policy" > "$config"
chmod 0644 "$config"
jq -n --arg file "$config" '{services: {"otel-collector": {
  command: ["--config=/etc/otelcol-contrib/config.yaml", "--config=/etc/otelcol-contrib/sampling-policy.json"],
  volumes: [{type: "bind", source: $file, target: "/etc/otelcol-contrib/sampling-policy.json", read_only: true}]
}}}' > "$compose"

docker compose -f docker-compose.yml -f "$compose" run --rm --no-deps otel-collector \
  validate --config=/etc/otelcol-contrib/config.yaml --config=/etc/otelcol-contrib/sampling-policy.json
current_revision=$(curl --fail --silent --show-error --connect-timeout 3 --max-time 10 "$api_url/sampling/policy" | jq -er '.policy.revision')
if [[ "$revision" != "$current_revision" ]]; then
  echo 'Sampling policy changed during validation; run this command again.' >&2
  exit 1
fi
docker compose -f docker-compose.yml -f "$compose" up -d --no-deps --force-recreate otel-collector
ready=0
for _ in $(seq 1 20); do
  if curl --fail --silent --show-error --max-time 2 http://127.0.0.1:13133/ >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 1
done
if [[ "$ready" != 1 ]]; then
  echo 'Collector did not become ready; inspect its logs before retrying.' >&2
  exit 1
fi
cp "$compose" "$project_dir/.local/sampling/compose.json"
printf 'Collector ready with sampling policy revision %s. Verify telemetry and logs.\n' "$revision"
