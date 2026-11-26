#!/usr/bin/env bash

# Health/readiness of Prometheus does not mean its scrape targets have reported.
wait_for_prometheus_target() {
  local job="$1"
  local attempts="${PROMETHEUS_WAIT_ATTEMPTS:-20}"
  local interval="${PROMETHEUS_WAIT_INTERVAL_SECONDS:-3}"
  local response=''
  local attempt

  for ((attempt = 1; attempt <= attempts; attempt++)); do
    if response=$(curl --fail --silent --show-error --get \
      --data-urlencode "query=up{job=\"$job\"}" \
      http://localhost:9090/api/v1/query) &&
      printf '%s' "$response" | jq --exit-status \
        '.status == "success" and any(.data.result[]?; .value[1] == "1")' >/dev/null; then
      printf 'Prometheus target %s is up (attempt %s/%s).\n' "$job" "$attempt" "$attempts"
      return 0
    fi
    if ((attempt < attempts)); then
      sleep "$interval"
    fi
  done

  printf 'Prometheus target %s did not become healthy after %s attempts. Last response: %s\n' \
    "$job" "$attempts" "${response:-<unavailable>}" >&2
  return 1
}

# A healthy target can have been scraped before a metric was first created.
wait_for_prometheus_series() {
  local query="$1"
  local attempts="${PROMETHEUS_WAIT_ATTEMPTS:-20}"
  local interval="${PROMETHEUS_WAIT_INTERVAL_SECONDS:-3}"
  local response=''
  local attempt

  for ((attempt = 1; attempt <= attempts; attempt++)); do
    if response=$(curl --fail --silent --show-error --get \
      --data-urlencode "query=$query" \
      http://localhost:9090/api/v1/query) &&
      printf '%s' "$response" | jq --exit-status \
        '.status == "success" and (.data.result | type == "array" and length > 0)' >/dev/null; then
      printf 'Prometheus series %s is available (attempt %s/%s).\n' "$query" "$attempt" "$attempts"
      return 0
    fi
    if ((attempt < attempts)); then
      sleep "$interval"
    fi
  done

  printf 'Prometheus series %s did not appear after %s attempts. Last response: %s\n' \
    "$query" "$attempts" "${response:-<unavailable>}" >&2
  return 1
}
