import { describe, expect, it } from 'vitest';

import { calculateSliEvaluation, overallSloStatus } from './slo.js';

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
});
