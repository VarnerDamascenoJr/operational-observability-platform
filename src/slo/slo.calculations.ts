import type {
  BurnRateSeverity,
  BurnRateWindowSummary,
  ObjectiveBurnRateResult,
  RollingSliSummary,
  RollingSliWindow,
  SliEvaluationResult,
  SliEventCounts,
  SliObjective,
  SliStatus,
} from '../slo.types.js';
import { millisecondsPerDay } from '../utils/time.js';

export function calculateSliEvaluation(
  objective: Pick<SliObjective, 'targetPercentage'>,
  counts: SliEventCounts,
): SliEvaluationResult {
  const badEvents = counts.totalEvents - counts.goodEvents;

  if (counts.totalEvents === 0) {
    return {
      badEvents,
      errorBudgetConsumedPercentage: null,
      errorBudgetRemainingPercentage: null,
      errorBudgetTotalEvents: null,
      goodEvents: counts.goodEvents,
      observedPercentage: null,
      status: 'no_data',
      targetPercentage: objective.targetPercentage,
      totalEvents: counts.totalEvents,
    };
  }

  const observedPercentage = round((counts.goodEvents / counts.totalEvents) * 100, 5);
  const errorBudgetTotalEvents = round(
    counts.totalEvents * (1 - objective.targetPercentage / 100),
    3,
  );
  const errorBudgetConsumedPercentage = round((badEvents / errorBudgetTotalEvents) * 100, 3);
  const errorBudgetRemainingPercentage = round(100 - errorBudgetConsumedPercentage, 3);

  return {
    badEvents,
    errorBudgetConsumedPercentage,
    errorBudgetRemainingPercentage,
    errorBudgetTotalEvents,
    goodEvents: counts.goodEvents,
    observedPercentage,
    status: observedPercentage >= objective.targetPercentage ? 'ok' : 'breached',
    targetPercentage: objective.targetPercentage,
    totalEvents: counts.totalEvents,
  };
}

export function overallSloStatus(
  results: readonly Pick<SliEvaluationResult, 'status'>[],
): SliStatus {
  if (results.some((result) => result.status === 'breached')) {
    return 'breached';
  }

  if (results.length === 0 || results.some((result) => result.status === 'no_data')) {
    return 'no_data';
  }

  return 'ok';
}

export function summarizeRollingWindows(windows: readonly RollingSliWindow[]): RollingSliSummary {
  const observedPercentages = windows.flatMap((window) =>
    window.observedPercentage === null ? [] : [window.observedPercentage],
  );
  const errorBudgetConsumptions = windows.flatMap((window) =>
    window.errorBudgetConsumedPercentage === null ? [] : [window.errorBudgetConsumedPercentage],
  );
  const latestWindow = windows.at(-1);

  return {
    averageObservedPercentage:
      observedPercentages.length === 0
        ? null
        : round(
            observedPercentages.reduce((total, value) => total + value, 0) /
              observedPercentages.length,
            5,
          ),
    breachedWindows: windows.filter((window) => window.status === 'breached').length,
    evaluatedWindows: windows.length,
    latestStatus: latestWindow?.status ?? 'no_data',
    latestWindowEndedAt: latestWindow?.endedAt ?? null,
    maxErrorBudgetConsumedPercentage:
      errorBudgetConsumptions.length === 0 ? null : Math.max(...errorBudgetConsumptions),
    minObservedPercentage:
      observedPercentages.length === 0 ? null : Math.min(...observedPercentages),
    noDataWindows: windows.filter((window) => window.status === 'no_data').length,
    totalBadEvents: windows.reduce((total, window) => total + window.badEvents, 0),
    totalEvents: windows.reduce((total, window) => total + window.totalEvents, 0),
    totalGoodEvents: windows.reduce((total, window) => total + window.goodEvents, 0),
  };
}

export function calculateBurnRateWindow(
  windows: readonly Pick<
    RollingSliWindow,
    'badEvents' | 'endedAt' | 'goodEvents' | 'startedAt' | 'totalEvents'
  >[],
  input: { targetPercentage: number; windowDays: number },
): BurnRateWindowSummary {
  if (windows.length === 0) {
    return emptyBurnRateWindow();
  }

  const startedAt = windows[0]?.startedAt ?? null;
  const endedAt = windows.at(-1)?.endedAt ?? null;
  const totalEvents = windows.reduce((total, window) => total + window.totalEvents, 0);
  const goodEvents = windows.reduce((total, window) => total + window.goodEvents, 0);
  const badEvents = windows.reduce((total, window) => total + window.badEvents, 0);
  const elapsedMilliseconds =
    startedAt && endedAt ? Date.parse(endedAt) - Date.parse(startedAt) : 0;
  const expectedBudgetConsumedPercentage =
    elapsedMilliseconds > 0
      ? round((elapsedMilliseconds / (input.windowDays * millisecondsPerDay)) * 100, 3)
      : null;

  if (totalEvents === 0 || expectedBudgetConsumedPercentage === null) {
    return {
      ...emptyBurnRateWindow(),
      badEvents,
      endedAt,
      expectedBudgetConsumedPercentage,
      goodEvents,
      startedAt,
      totalEvents,
      windowCount: windows.length,
    };
  }

  const observedPercentage = round((goodEvents / totalEvents) * 100, 5);
  const errorBudgetTotalEvents = totalEvents * (1 - input.targetPercentage / 100);
  const errorBudgetConsumedPercentage = round((badEvents / errorBudgetTotalEvents) * 100, 3);

  return {
    badEvents,
    burnRate: round(errorBudgetConsumedPercentage / expectedBudgetConsumedPercentage, 3),
    endedAt,
    errorBudgetConsumedPercentage,
    expectedBudgetConsumedPercentage,
    goodEvents,
    observedPercentage,
    startedAt,
    status: observedPercentage >= input.targetPercentage ? 'ok' : 'breached',
    totalEvents,
    windowCount: windows.length,
  };
}

export function classifyMultiWindowBurnRate(
  shortWindow: Pick<BurnRateWindowSummary, 'burnRate'>,
  longWindow: Pick<BurnRateWindowSummary, 'burnRate'>,
): BurnRateSeverity {
  if (shortWindow.burnRate === null && longWindow.burnRate === null) {
    return 'no_data';
  }

  const shortBurnRate = shortWindow.burnRate ?? 0;
  const longBurnRate = longWindow.burnRate ?? 0;

  if (shortBurnRate >= 4 && longBurnRate >= 2) {
    return 'page';
  }

  if (shortBurnRate >= 4 || longBurnRate >= 2) {
    return 'warning';
  }

  if (shortBurnRate >= 1 || longBurnRate >= 1) {
    return 'watch';
  }

  return 'ok';
}

export function calculateObjectiveBurnRate(
  objective: Pick<SliObjective, 'latencyThresholdMilliseconds' | 'targetPercentage' | 'type'>,
  windows: readonly RollingSliWindow[],
  input: { longWindowCount: number; shortWindowCount: number; windowDays: number },
): ObjectiveBurnRateResult {
  const shortWindow = calculateBurnRateWindow(windows.slice(-input.shortWindowCount), {
    targetPercentage: objective.targetPercentage,
    windowDays: input.windowDays,
  });
  const longWindow = calculateBurnRateWindow(windows.slice(-input.longWindowCount), {
    targetPercentage: objective.targetPercentage,
    windowDays: input.windowDays,
  });
  const severity = classifyMultiWindowBurnRate(shortWindow, longWindow);

  return {
    interpretation: burnRateInterpretation(severity),
    ...(objective.latencyThresholdMilliseconds
      ? { latencyThresholdMilliseconds: objective.latencyThresholdMilliseconds }
      : {}),
    longWindow,
    severity,
    shortWindow,
    targetPercentage: objective.targetPercentage,
    type: objective.type,
  };
}

export function overallBurnRateSeverity(
  objectives: readonly Pick<ObjectiveBurnRateResult, 'severity'>[],
): BurnRateSeverity {
  const order: Record<BurnRateSeverity, number> = {
    no_data: 0,
    ok: 1,
    watch: 2,
    warning: 3,
    page: 4,
  };

  if (objectives.length === 0) {
    return 'no_data';
  }

  return objectives.reduce<BurnRateSeverity>(
    (highest, objective) =>
      order[objective.severity] > order[highest] ? objective.severity : highest,
    'no_data',
  );
}

export function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function emptyBurnRateWindow(): BurnRateWindowSummary {
  return {
    badEvents: 0,
    burnRate: null,
    endedAt: null,
    errorBudgetConsumedPercentage: null,
    expectedBudgetConsumedPercentage: null,
    goodEvents: 0,
    observedPercentage: null,
    startedAt: null,
    status: 'no_data',
    totalEvents: 0,
    windowCount: 0,
  };
}

function burnRateInterpretation(severity: BurnRateSeverity): string {
  switch (severity) {
    case 'page':
      return 'Short and long windows are burning error budget fast enough to require immediate response.';
    case 'warning':
      return 'One burn-rate window is above the escalation threshold; investigate before the SLO is exhausted.';
    case 'watch':
      return 'Error budget is being consumed faster than the steady-state allowance.';
    case 'ok':
      return 'Error budget consumption is within the expected pace for the SLO horizon.';
    case 'no_data':
      return 'There are not enough evaluated events to estimate burn rate.';
  }
}
