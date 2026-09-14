#!/usr/bin/env bash

set -euo pipefail

docker compose config --quiet
docker compose run --rm --no-deps otel-collector validate --config=/etc/otelcol-contrib/config.yaml
docker compose run --rm --no-deps --entrypoint=promtool prometheus check config /etc/prometheus/prometheus.yml
docker compose run --rm --no-deps --entrypoint=/bin/sh prometheus -c 'promtool check rules /etc/prometheus/rules/*.yml'
for dashboard in observability/grafana/dashboards/*.json; do
  jq --exit-status '.uid and .title and ((.panels | length) > 0)' "$dashboard" >/dev/null
done

grep --quiet 'Portfolio Observability' observability/grafana/provisioning/dashboards/dashboards.yaml
grep --quiet '/etc/grafana/dashboards' observability/grafana/provisioning/dashboards/dashboards.yaml
