import { describe, expect, it } from 'vitest';

import {
  calculateSliEvaluation,
  overallSloStatus,
  renderSloPrometheusMetrics,
  summarizeRollingWindows,
} from './slo.js';
import type { SqlExecutor } from './database/postgres.js';
import type { QueryResult, QueryResultRow } from 'pg';

describe('SLO calculations', () => {
  it('calculates availability SLI and remaining error budget', () => {
    expect(
      calculateSliEvaluation(
        { targetPercentage: 99 },
        {
          goodEvents: 995,
          totalEvents: 1_000,
        },
      ),
    ).toEqual({
      badEvents: 5,
      errorBudgetConsumedPercentage: 50,
      errorBudgetRemainingPercentage: 50,
      errorBudgetTotalEvents: 10,
      goodEvents: 995,
      observedPercentage: 99.5,
      status: 'ok',
      targetPercentage: 99,
      totalEvents: 1_000,
    });
  });

  it('marks an SLI as breached when bad events exceed the budget', () => {
    expect(
      calculateSliEvaluation(
        { targetPercentage: 95 },
        {
          goodEvents: 900,
          totalEvents: 1_000,
        },
      ),
    ).toEqual({
      badEvents: 100,
      errorBudgetConsumedPercentage: 200,
      errorBudgetRemainingPercentage: -100,
      errorBudgetTotalEvents: 50,
      goodEvents: 900,
      observedPercentage: 90,
      status: 'breached',
      targetPercentage: 95,
      totalEvents: 1_000,
    });
  });

  it('keeps windows without events separate from healthy windows', () => {
    expect(
      calculateSliEvaluation(
        { targetPercentage: 99 },
        {
          goodEvents: 0,
          totalEvents: 0,
        },
      ),
    ).toEqual({
      badEvents: 0,
      errorBudgetConsumedPercentage: null,
      errorBudgetRemainingPercentage: null,
      errorBudgetTotalEvents: null,
      goodEvents: 0,
      observedPercentage: null,
      status: 'no_data',
      targetPercentage: 99,
      totalEvents: 0,
    });
  });

  it('summarizes overall SLO status from all objectives', () => {
    expect(overallSloStatus([{ status: 'ok' }, { status: 'ok' }])).toBe('ok');
    expect(overallSloStatus([{ status: 'ok' }, { status: 'no_data' }])).toBe('no_data');
    expect(overallSloStatus([{ status: 'ok' }, { status: 'breached' }])).toBe('breached');
  });

  it('summarizes rolling SLI windows for trend analysis', () => {
    expect(
      summarizeRollingWindows([
        {
          badEvents: 10,
          endedAt: '2026-09-13T00:00:00.000Z',
          errorBudgetConsumedPercentage: 100,
          errorBudgetRemainingPercentage: 0,
          errorBudgetTotalEvents: 10,
          goodEvents: 990,
          observedPercentage: 99,
          source: { kind: 'fixture', period: '1d', query: 'fixtures/slo/windows.json' },
          startedAt: '2026-09-12T00:00:00.000Z',
          status: 'ok',
          targetPercentage: 99,
          totalEvents: 1_000,
        },
        {
          badEvents: 0,
          endedAt: '2026-09-14T00:00:00.000Z',
          errorBudgetConsumedPercentage: null,
          errorBudgetRemainingPercentage: null,
          errorBudgetTotalEvents: null,
          goodEvents: 0,
          observedPercentage: null,
          source: { kind: 'fixture', period: '1d', query: 'fixtures/slo/windows.json' },
          startedAt: '2026-09-13T00:00:00.000Z',
          status: 'no_data',
          targetPercentage: 99,
          totalEvents: 0,
        },
        {
          badEvents: 20,
          endedAt: '2026-09-15T00:00:00.000Z',
          errorBudgetConsumedPercentage: 200,
          errorBudgetRemainingPercentage: -100,
          errorBudgetTotalEvents: 10,
          goodEvents: 980,
          observedPercentage: 98,
          source: { kind: 'fixture', period: '1d', query: 'fixtures/slo/windows.json' },
          startedAt: '2026-09-14T00:00:00.000Z',
          status: 'breached',
          targetPercentage: 99,
          totalEvents: 1_000,
        },
      ]),
    ).toEqual({
      averageObservedPercentage: 98.5,
      breachedWindows: 1,
      evaluatedWindows: 3,
      latestStatus: 'breached',
      latestWindowEndedAt: '2026-09-15T00:00:00.000Z',
      maxErrorBudgetConsumedPercentage: 200,
      minObservedPercentage: 98,
      noDataWindows: 1,
      totalBadEvents: 30,
      totalEvents: 2_000,
      totalGoodEvents: 1_970,
    });
  });
});

describe('SLO Prometheus metrics', () => {
  it('renders latest SLO error budget gauges', async () => {
    const database: SqlExecutor = {
      async query<Row extends QueryResultRow = QueryResultRow>() {
        return queryResult<Row>([
          {
            service_slug: 'operational-observability-platform',
            environment: 'test',
            slo_slug: 'demo-transaction-slo',
            indicator_type: 'latency',
            observed_percentage: '94.00000',
            error_budget_consumed_percentage: '120.000',
            error_budget_remaining_percentage: '-20.000',
            status: 'breached',
            window_ended_at: new Date('2026-09-14T00:00:00.000Z'),
          } as unknown as Row,
        ]);
      },
    };

    await expect(renderSloPrometheusMetrics(database)).resolves.toContain(
      'slo_error_budget_consumed_percentage{service="operational-observability-platform",environment="test",slo="demo-transaction-slo",sli_type="latency",status="breached"} 120',
    );
  });
});

function queryResult<Row extends QueryResultRow>(rows: Row[]): QueryResult<Row> {
  return {
    command: 'SELECT',
    fields: [],
    oid: 0,
    rowCount: rows.length,
    rows,
  };
}
