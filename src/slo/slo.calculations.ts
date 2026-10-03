import type {
  BurnRateSeverity,
  BurnRateWindowSummary,
  ObjectiveBurnRateResult,
  ProcessControlAnomaly,
  ProcessControlObjectiveResult,
  ProcessControlOptions,
  ProcessControlSeverity,
  RollingSliSummary,
  RollingSliWindow,
  SliEvaluationResult,
  SliEventCounts,
  SliObjective,
  SliStatus,
} from './slo.types.js';
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

export function analyzeObjectiveProcessControl(
  objective: Pick<SliObjective, 'latencyThresholdMilliseconds' | 'targetPercentage' | 'type'>,
  windows: readonly RollingSliWindow[],
  options: ProcessControlOptions,
): ProcessControlObjectiveResult {
  const evaluatedWindows = windows.filter((window) => window.totalEvents > 0);
  const baselineWindows = evaluatedWindows.slice(0, options.baselineWindowCount);
  const monitoredWindows = evaluatedWindows.slice(options.baselineWindowCount);
  const baselineRates = baselineWindows.map(badEventPercentage);

  if (baselineRates.length < options.baselineWindowCount || monitoredWindows.length === 0) {
    return {
      anomalies: [],
      baseline: {
        meanBadEventPercentage: baselineRates.length === 0 ? null : round(mean(baselineRates), 5),
        sampleSize: baselineRates.length,
        standardDeviation:
          baselineRates.length < 2 ? null : round(sampleStandardDeviation(baselineRates), 5),
        upperControlLimit: null,
      },
      interpretation: processControlInterpretation('no_data'),
      ...(objective.latencyThresholdMilliseconds
        ? { latencyThresholdMilliseconds: objective.latencyThresholdMilliseconds }
        : {}),
      observations: evaluatedWindows.map((window) =>
        processControlObservation(window, {
          anomalous: false,
          ewmaBadEventPercentage: null,
          upperControlLimit: null,
        }),
      ),
      pattern: 'normal',
      severity: 'no_data',
      targetPercentage: objective.targetPercentage,
      type: objective.type,
    };
  }

  const baselineMean = mean(baselineRates);
  const baselineStandardDeviation = sampleStandardDeviation(baselineRates);
  const effectiveStandardDeviation =
    baselineStandardDeviation === 0 ? minimumSigma(baselineMean) : baselineStandardDeviation;
  const ewmaStandardDeviation =
    effectiveStandardDeviation * Math.sqrt(options.ewmaLambda / (2 - options.ewmaLambda));
  const upperControlLimit = round(
    baselineMean + options.sigmaMultiplier * ewmaStandardDeviation,
    5,
  );
  let ewma = baselineMean;
  let consecutiveAnomalies = 0;
  const anomalies: ProcessControlAnomaly[] = [];
  const observations = baselineWindows.map((window) =>
    processControlObservation(window, {
      anomalous: false,
      ewmaBadEventPercentage: null,
      upperControlLimit,
    }),
  );

  for (const window of monitoredWindows) {
    const badRate = badEventPercentage(window);
    ewma = options.ewmaLambda * badRate + (1 - options.ewmaLambda) * ewma;
    const roundedEwma = round(ewma, 5);
    const anomalous = roundedEwma > upperControlLimit;

    consecutiveAnomalies = anomalous ? consecutiveAnomalies + 1 : 0;
    observations.push(
      processControlObservation(window, {
        anomalous,
        ewmaBadEventPercentage: roundedEwma,
        upperControlLimit,
      }),
    );

    if (anomalous) {
      const pattern =
        consecutiveAnomalies >= options.sustainedWindowCount ? 'sustained_shift' : 'isolated_spike';
      const severity = pattern === 'sustained_shift' ? 'warning' : 'watch';

      anomalies.push({
        badEventPercentage: round(badRate, 5),
        endedAt: window.endedAt,
        evidence: {
          description: [
            `SPC detected ${pattern.replace('_', ' ')} for ${objective.type}.`,
            `EWMA bad-event rate ${roundedEwma}% exceeded upper control limit ${upperControlLimit}%.`,
            `Baseline mean was ${round(baselineMean, 5)}% over ${baselineRates.length} windows.`,
          ].join(' '),
          title: `SPC anomaly on ${objective.type} SLI`,
          type: 'note',
        },
        ewmaBadEventPercentage: roundedEwma,
        pattern,
        severity,
        upperControlLimit,
      });
    }
  }

  const pattern = anomalies.some((anomaly) => anomaly.pattern === 'sustained_shift')
    ? 'sustained_shift'
    : anomalies.length > 0
      ? 'isolated_spike'
      : 'normal';
  const severity = processControlSeverity(pattern);

  return {
    anomalies,
    baseline: {
      meanBadEventPercentage: round(baselineMean, 5),
      sampleSize: baselineRates.length,
      standardDeviation: round(baselineStandardDeviation, 5),
      upperControlLimit,
    },
    interpretation: processControlInterpretation(severity),
    ...(objective.latencyThresholdMilliseconds
      ? { latencyThresholdMilliseconds: objective.latencyThresholdMilliseconds }
      : {}),
    observations,
    pattern,
    severity,
    targetPercentage: objective.targetPercentage,
    type: objective.type,
  };
}

export function overallProcessControlSeverity(
  objectives: readonly Pick<ProcessControlObjectiveResult, 'severity'>[],
): ProcessControlSeverity {
  const order: Record<ProcessControlSeverity, number> = {
    no_data: 0,
    ok: 1,
    watch: 2,
    warning: 3,
  };

  if (objectives.length === 0) {
    return 'no_data';
  }

  return objectives.reduce<ProcessControlSeverity>(
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

function badEventPercentage(window: Pick<RollingSliWindow, 'badEvents' | 'totalEvents'>): number {
  return window.totalEvents === 0 ? 0 : (window.badEvents / window.totalEvents) * 100;
}

function mean(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((total, value) => total + value, 0) / values.length;
}

function minimumSigma(baselineMean: number): number {
  return Math.max(0.1, baselineMean * 0.1);
}

function processControlObservation(
  window: RollingSliWindow,
  input: {
    anomalous: boolean;
    ewmaBadEventPercentage: number | null;
    upperControlLimit: number | null;
  },
) {
  return {
    anomalous: input.anomalous,
    badEventPercentage: window.totalEvents === 0 ? null : round(badEventPercentage(window), 5),
    endedAt: window.endedAt,
    ewmaBadEventPercentage: input.ewmaBadEventPercentage,
    goodEvents: window.goodEvents,
    source: window.source,
    startedAt: window.startedAt,
    totalEvents: window.totalEvents,
    upperControlLimit: input.upperControlLimit,
  };
}

function processControlSeverity(
  pattern: ProcessControlObjectiveResult['pattern'],
): ProcessControlSeverity {
  switch (pattern) {
    case 'sustained_shift':
      return 'warning';
    case 'isolated_spike':
      return 'watch';
    case 'normal':
      return 'ok';
  }
}

function processControlInterpretation(severity: ProcessControlSeverity): string {
  switch (severity) {
    case 'warning':
      return 'EWMA shows a sustained shift above the historical control limit; investigate as an anomaly evidence.';
    case 'watch':
      return 'EWMA crossed the historical control limit in an isolated window; watch for recurrence before escalating.';
    case 'ok':
      return 'Recent bad-event rate is inside the historical control limit.';
    case 'no_data':
      return 'There are not enough baseline and monitored windows to estimate statistical process control.';
  }
}

function sampleStandardDeviation(values: readonly number[]): number {
  if (values.length < 2) {
    return 0;
  }

  const average = mean(values);
  const sumSquaredDistance = values.reduce((total, value) => total + (value - average) ** 2, 0);
  return Math.sqrt(sumSquaredDistance / (values.length - 1));
}
