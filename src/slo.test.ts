import { describe, expect, it } from 'vitest';

import {
  calculateBurnRateWindow,
  calculateObjectiveBurnRate,
  calculateSliEvaluation,
  classifyMultiWindowBurnRate,
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

  it('calculates burn rate against the SLO horizon', () => {
    expect(
      calculateBurnRateWindow(
        [
          {
            badEvents: 60,
            endedAt: '2026-09-15T00:00:00.000Z',
            goodEvents: 940,
            startedAt: '2026-09-14T00:00:00.000Z',
            totalEvents: 1_000,
          },
        ],
        { targetPercentage: 95, windowDays: 7 },
      ),
    ).toEqual({
      badEvents: 60,
      burnRate: 8.4,
      endedAt: '2026-09-15T00:00:00.000Z',
      errorBudgetConsumedPercentage: 120,
      expectedBudgetConsumedPercentage: 14.286,
      goodEvents: 940,
      observedPercentage: 94,
      startedAt: '2026-09-14T00:00:00.000Z',
      status: 'breached',
      totalEvents: 1_000,
      windowCount: 1,
    });
  });

  it('classifies short spikes, slow burns and sustained burns separately', () => {
    expect(classifyMultiWindowBurnRate({ burnRate: 4.5 }, { burnRate: 0.8 })).toBe('warning');
    expect(classifyMultiWindowBurnRate({ burnRate: 0.8 }, { burnRate: 2.2 })).toBe('warning');
    expect(classifyMultiWindowBurnRate({ burnRate: 4.5 }, { burnRate: 2.2 })).toBe('page');
    expect(classifyMultiWindowBurnRate({ burnRate: 1.2 }, { burnRate: 0.8 })).toBe('watch');
    expect(classifyMultiWindowBurnRate({ burnRate: null }, { burnRate: null })).toBe('no_data');
  });

  it('combines short and long windows into an objective burn-rate decision', () => {
    const result = calculateObjectiveBurnRate(
      { targetPercentage: 95, type: 'latency' },
      [
        {
          badEvents: 20,
          endedAt: '2026-09-13T00:00:00.000Z',
          errorBudgetConsumedPercentage: 40,
          errorBudgetRemainingPercentage: 60,
          errorBudgetTotalEvents: 50,
          goodEvents: 980,
          observedPercentage: 98,
          source: { kind: 'fixture' },
          startedAt: '2026-09-12T00:00:00.000Z',
          status: 'ok',
          targetPercentage: 95,
          totalEvents: 1_000,
        },
        {
          badEvents: 60,
          endedAt: '2026-09-14T00:00:00.000Z',
          errorBudgetConsumedPercentage: 120,
          errorBudgetRemainingPercentage: -20,
          errorBudgetTotalEvents: 50,
          goodEvents: 940,
          observedPercentage: 94,
          source: { kind: 'fixture' },
          startedAt: '2026-09-13T00:00:00.000Z',
          status: 'breached',
          targetPercentage: 95,
          totalEvents: 1_000,
        },
      ],
      { longWindowCount: 2, shortWindowCount: 1, windowDays: 7 },
    );

    expect(result).toEqual(
      expect.objectContaining({
        longWindow: expect.objectContaining({
          burnRate: 2.8,
          errorBudgetConsumedPercentage: 80,
          expectedBudgetConsumedPercentage: 28.571,
        }),
        severity: 'page',
        shortWindow: expect.objectContaining({
          burnRate: 8.4,
        }),
        type: 'latency',
      }),
    );
  });
});

describe('SLO Prometheus metrics', () => {
  it('renders latest SLO error budget gauges', async () => {
    const database: SqlExecutor = {
      async query<Row extends QueryResultRow = QueryResultRow>(statement: string) {
        if (statement.includes('sli.target_percentage')) {
          return queryResult<Row>([
            {
              service_slug: 'operational-observability-platform',
              environment: 'test',
              slo_slug: 'demo-transaction-slo',
              window_days: 7,
              indicator_type: 'latency',
              latency_threshold_ms: 500,
              target_percentage: '95.000',
              window_started_at: new Date('2026-09-13T00:00:00.000Z'),
              window_ended_at: new Date('2026-09-14T00:00:00.000Z'),
              total_events: '1000',
              good_events: '940',
            } as unknown as Row,
          ]);
        }

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
    await expect(renderSloPrometheusMetrics(database)).resolves.toContain(
      'slo_error_budget_burn_rate{service="operational-observability-platform",environment="test",slo="demo-transaction-slo",sli_type="latency",severity="page",window="short"} 8.4',
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
