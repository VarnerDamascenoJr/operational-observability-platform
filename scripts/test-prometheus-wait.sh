#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/lib/wait-for-prometheus.sh"
state_file=$(mktemp)
trap 'rm -f "$state_file"' EXIT

curl() {
  local count
  count=$(cat "$state_file")
  count=$((count + 1))
  printf '%s' "$count" >"$state_file"
  if ((count >= succeed_on)); then
    printf '%s' '{"status":"success","data":{"result":[{"value":[123,"1"]}]}}'
  else
    printf '%s' '{"status":"success","data":{"result":[]}}'
  fi
}
sleep() { :; }

printf 0 >"$state_file"
succeed_on=3
PROMETHEUS_WAIT_ATTEMPTS=3 wait_for_prometheus_target otel-collector >/dev/null
[ "$(cat "$state_file")" = 3 ]

printf 0 >"$state_file"
succeed_on=4
if PROMETHEUS_WAIT_ATTEMPTS=3 wait_for_prometheus_target otel-collector >/dev/null 2>&1; then
  echo 'Expected timeout for an unavailable target' >&2
  exit 1
fi
[ "$(cat "$state_file")" = 3 ]
echo 'Prometheus target wait tests passed.'
