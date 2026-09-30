import type { SqlExecutor } from '../database/postgres.js';
import {
  latestSloBurnRateRowsSql,
  latestSloMetricRowsSql,
  sloPrometheusMetricDefinitions,
} from './slo.prometheus.js';
import type { RollingSliWindow, SloBurnRateMetricRow, SloMetricRow } from './slo.types.js';
import { calculateObjectiveBurnRate, calculateSliEvaluation } from './slo.calculations.js';
import { renderPrometheusMetricDefinitions } from '../utils/prometheus.js';

export async function renderSloPrometheusMetrics(database: SqlExecutor): Promise<string> {
  const result = await database.query<SloMetricRow>(latestSloMetricRowsSql);

  const lines = renderPrometheusMetricDefinitions(sloPrometheusMetricDefinitions);

  for (const row of result.rows) {
    const labels = metricLabels({
      service: row.service_slug,
      environment: row.environment,
      slo: row.slo_slug,
      sli_type: row.indicator_type,
      status: row.status ?? 'no_data',
    });

    if (row.observed_percentage !== null) {
      lines.push(`slo_observed_percentage{${labels}} ${Number(row.observed_percentage)}`);
    }

    if (row.error_budget_consumed_percentage !== null) {
      lines.push(
        `slo_error_budget_consumed_percentage{${labels}} ${Number(
          row.error_budget_consumed_percentage,
        )}`,
      );
    }

    if (row.error_budget_remaining_percentage !== null) {
      lines.push(
        `slo_error_budget_remaining_percentage{${labels}} ${Number(
          row.error_budget_remaining_percentage,
        )}`,
      );
    }
  }

  lines.push(...(await renderSloBurnRateMetricLines(database)));

  return `${lines.join('\n')}\n`;
}

async function renderSloBurnRateMetricLines(database: SqlExecutor): Promise<string[]> {
  const result = await database.query<SloBurnRateMetricRow>(latestSloBurnRateRowsSql);
  const rowsByObjective = new Map<string, SloBurnRateMetricRow[]>();

  for (const row of result.rows) {
    const key = [
      row.service_slug,
      row.environment,
      row.slo_slug,
      row.indicator_type,
      row.target_percentage,
    ].join('\0');
    const rows = rowsByObjective.get(key) ?? [];
    rows.push(row);
    rowsByObjective.set(key, rows);
  }

  return Array.from(rowsByObjective.values()).flatMap((rows) => {
    const first = rows[0];

    if (!first) {
      return [];
    }

    const windows = rows.flatMap((row): RollingSliWindow[] => {
      if (
        !row.window_started_at ||
        !row.window_ended_at ||
        row.total_events === null ||
        row.good_events === null
      ) {
        return [];
      }

      const totalEvents = Number(row.total_events);
      const goodEvents = Number(row.good_events);

      return [
        {
          ...calculateSliEvaluation(
            { targetPercentage: Number(row.target_percentage) },
            { goodEvents, totalEvents },
          ),
          endedAt: row.window_ended_at.toISOString(),
          source: { kind: 'manual' },
          startedAt: row.window_started_at.toISOString(),
        },
      ];
    });

    const burnRate = calculateObjectiveBurnRate(
      {
        ...(first.latency_threshold_ms
          ? { latencyThresholdMilliseconds: first.latency_threshold_ms }
          : {}),
        targetPercentage: Number(first.target_percentage),
        type: first.indicator_type,
      },
      windows,
      {
        longWindowCount: 6,
        shortWindowCount: 1,
        windowDays: first.window_days,
      },
    );

    const baseLabels = {
      service: first.service_slug,
      environment: first.environment,
      slo: first.slo_slug,
      sli_type: first.indicator_type,
      severity: burnRate.severity,
    };

    return [
      burnRate.shortWindow.burnRate === null
        ? undefined
        : `slo_error_budget_burn_rate{${metricLabels({
            ...baseLabels,
            window: 'short',
          })}} ${burnRate.shortWindow.burnRate}`,
      burnRate.longWindow.burnRate === null
        ? undefined
        : `slo_error_budget_burn_rate{${metricLabels({
            ...baseLabels,
            window: 'long',
          })}} ${burnRate.longWindow.burnRate}`,
    ].flatMap((line) => (line ? [line] : []));
  });
}

function metricLabels(labels: Record<string, string>): string {
  return Object.entries(labels)
    .map(([key, value]) => `${key}="${escapeMetricLabel(value)}"`)
    .join(',');
}

function escapeMetricLabel(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('\n', '\\n').replaceAll('"', '\\"');
}
