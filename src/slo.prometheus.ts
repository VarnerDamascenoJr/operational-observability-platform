import type { PrometheusMetricDefinition } from './utils/prometheus.js';

export const sloPrometheusMetricDefinitions = [
  {
    help: 'Latest observed SLI percentage by service, SLO and indicator.',
    name: 'slo_observed_percentage',
    type: 'gauge',
  },
  {
    help: 'Latest consumed error budget percentage by service, SLO and indicator.',
    name: 'slo_error_budget_consumed_percentage',
    type: 'gauge',
  },
  {
    help: 'Latest remaining error budget percentage by service, SLO and indicator.',
    name: 'slo_error_budget_remaining_percentage',
    type: 'gauge',
  },
  {
    help: 'Error budget burn rate by rolling SLI evaluation window.',
    name: 'slo_error_budget_burn_rate',
    type: 'gauge',
  },
] satisfies readonly PrometheusMetricDefinition[];

export const latestSloMetricRowsSql = `
  SELECT
    slo.slug AS slo_slug,
    svc.slug AS service_slug,
    svc.environment,
    sli.indicator_type,
    latest.observed_percentage,
    latest.error_budget_consumed_percentage,
    latest.error_budget_remaining_percentage,
    latest.status,
    latest.window_ended_at
  FROM control_plane.sli_definitions sli
  JOIN control_plane.slo_definitions slo ON slo.id = sli.slo_id
  JOIN control_plane.services svc ON svc.id = slo.service_id
  LEFT JOIN LATERAL (
    SELECT
      observed_percentage,
      error_budget_consumed_percentage,
      error_budget_remaining_percentage,
      status,
      window_ended_at
    FROM control_plane.sli_evaluation_windows evaluation_window
    WHERE evaluation_window.sli_id = sli.id
    ORDER BY evaluation_window.window_ended_at DESC
    LIMIT 1
  ) latest ON true
  WHERE latest.window_ended_at IS NOT NULL
  ORDER BY svc.slug, slo.slug, sli.indicator_type
`;

export const latestSloBurnRateRowsSql = `
  SELECT
    slo.slug AS slo_slug,
    svc.slug AS service_slug,
    svc.environment,
    slo.window_days,
    sli.indicator_type,
    sli.latency_threshold_ms,
    sli.target_percentage,
    latest.window_started_at,
    latest.window_ended_at,
    latest.total_events,
    latest.good_events
  FROM control_plane.sli_definitions sli
  JOIN control_plane.slo_definitions slo ON slo.id = sli.slo_id
  JOIN control_plane.services svc ON svc.id = slo.service_id
  LEFT JOIN LATERAL (
    SELECT
      window_started_at,
      window_ended_at,
      total_events,
      good_events
    FROM control_plane.sli_evaluation_windows evaluation_window
    WHERE evaluation_window.sli_id = sli.id
    ORDER BY evaluation_window.window_ended_at DESC
    LIMIT 6
  ) latest ON true
  WHERE latest.window_ended_at IS NOT NULL
  ORDER BY svc.slug, slo.slug, sli.indicator_type, latest.window_ended_at ASC
`;
