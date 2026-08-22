#!/usr/bin/env bash

set -euo pipefail

docker compose config --quiet
docker compose run --rm --no-deps otel-collector validate --config=/etc/otelcol-contrib/config.yaml
docker compose run --rm --no-deps --entrypoint=promtool prometheus check config /etc/prometheus/prometheus.yml
