#!/usr/bin/env bash
set -euo pipefail

test_dir=$(mktemp -d)
trap 'rm -rf "$test_dir"' EXIT
mkdir -p "$test_dir/project/scripts" "$test_dir/bin"
cp "$(dirname "$0")/apply-sampling-policy.sh" "$test_dir/project/scripts/"
: > "$test_dir/project/docker-compose.yml"
export TEST_DIR="$test_dir"
cat > "$test_dir/bin/curl" <<'MOCK'
#!/usr/bin/env bash
count=$(cat "$TEST_DIR/count")
count=$((count + 1))
printf %s "$count" > "$TEST_DIR/count"
revision=7
if [[ "${CHANGE_ON_SECOND:-0}" = 1 && "$count" -gt 1 ]]; then revision=8; fi
printf '{"policy":{"revision":%s,"latencyThresholdMs":750,"healthySamplingPercentage":0}}' "$revision"
MOCK
cat > "$test_dir/bin/docker" <<'MOCK'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$TEST_DIR/docker.log"
if [[ "${FAIL_VALIDATION:-0}" = 1 && " $* " = *' run '* ]]; then exit 1; fi
MOCK
chmod +x "$test_dir/bin/curl" "$test_dir/bin/docker"
export PATH="$test_dir/bin:$PATH"
printf 0 > "$test_dir/count"
bash "$test_dir/project/scripts/apply-sampling-policy.sh" >/dev/null
compose="$test_dir/project/.local/sampling/compose.json"
config=$(jq -r '.services["otel-collector"].volumes[0].source' "$compose")
jq -e '.processors.tail_sampling.policies | any(.name == "errors" and .status_code.status_codes == ["ERROR"]) and any(.name == "slow" and .latency.threshold_ms == 750) and any(.name == "healthy" and .probabilistic.sampling_percentage == 0)' "$config" >/dev/null
[[ $(stat -c '%a' "$config") = 644 ]]
jq -e '.services["otel-collector"].command | length == 2' "$compose" >/dev/null
[[ $(wc -l < "$test_dir/docker.log") = 2 ]]
cp "$compose" "$test_dir/applied-compose"
cp "$config" "$test_dir/applied-policy"
: > "$test_dir/docker.log"
printf 0 > "$test_dir/count"
if CHANGE_ON_SECOND=1 bash "$test_dir/project/scripts/apply-sampling-policy.sh" >/dev/null 2>&1; then
  echo 'Expected apply to reject a changed revision' >&2
  exit 1
fi
[[ $(wc -l < "$test_dir/docker.log") = 1 ]]
cmp "$compose" "$test_dir/applied-compose"
cmp "$config" "$test_dir/applied-policy"
: > "$test_dir/docker.log"
printf 0 > "$test_dir/count"
if FAIL_VALIDATION=1 bash "$test_dir/project/scripts/apply-sampling-policy.sh" >/dev/null 2>&1; then
  echo 'Expected apply to stop when Collector validation fails' >&2
  exit 1
fi
[[ $(wc -l < "$test_dir/docker.log") = 1 ]]
cmp "$compose" "$test_dir/applied-compose"
cmp "$config" "$test_dir/applied-policy"
echo 'Sampling policy apply tests passed.'
