export interface HttpMetricSample {
  method: string;
  route: string;
  statusCode: number;
  durationSeconds: number;
}

export type DemoDependencyMode = 'normal' | 'slow' | 'unavailable';
export type DemoTransactionOutcome = 'error' | 'success';

export interface DemoTransactionMetricSample {
  dependencyMode: DemoDependencyMode;
  durationSeconds: number;
  outcome: DemoTransactionOutcome;
}

interface MetricsIdentity {
  service: string;
  environment: string;
}

interface DurationAggregate {
  buckets: number[];
  count: number;
  labels: Record<string, string>;
  sum: number;
}

const durationBucketsSeconds = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

export interface LatencyDistributionSnapshot {
  count: number;
  labels: Record<string, string>;
  meanMilliseconds: number;
  metric: string;
  quantilesMilliseconds: {
    p50: number | null;
    p90: number | null;
    p95: number | null;
    p99: number | null;
  };
  tailToMeanRatio: number | null;
}

export class HttpMetrics {
  private readonly identity: MetricsIdentity;
  private readonly requests = new Map<string, number>();
  private readonly errors = new Map<string, number>();
  private readonly durations = new Map<string, DurationAggregate>();
  private readonly demoTransactions = new Map<string, number>();
  private readonly demoTransactionDurations = new Map<string, DurationAggregate>();

  constructor(identity: MetricsIdentity) {
    this.identity = identity;
  }

  record(sample: HttpMetricSample): void {
    const labels = {
      service: this.identity.service,
      environment: this.identity.environment,
      method: sample.method,
      route: sample.route,
      status: String(sample.statusCode),
    };
    const key = labelsKey(labels);
    this.requests.set(key, (this.requests.get(key) ?? 0) + 1);

    if (sample.statusCode >= 500) {
      this.errors.set(key, (this.errors.get(key) ?? 0) + 1);
    }

    recordDuration(this.durations, labels, sample.durationSeconds);
  }

  recordDemoTransaction(sample: DemoTransactionMetricSample): void {
    const labels = {
      service: this.identity.service,
      environment: this.identity.environment,
      outcome: sample.outcome,
      dependency_mode: sample.dependencyMode,
    };
    const key = labelsKey(labels);
    this.demoTransactions.set(key, (this.demoTransactions.get(key) ?? 0) + 1);
    recordDuration(this.demoTransactionDurations, labels, sample.durationSeconds);
  }

  latencyDistributions(): LatencyDistributionSnapshot[] {
    return [
      ...durationDistributionSnapshots('http_request_duration_seconds', this.durations),
      ...durationDistributionSnapshots(
        'demo_transaction_duration_seconds',
        this.demoTransactionDurations,
      ),
    ].sort((left, right) => {
      if (left.metric !== right.metric) {
        return left.metric < right.metric ? -1 : 1;
      }

      return labelsKey(left.labels).localeCompare(labelsKey(right.labels));
    });
  }

  renderPrometheus(): string {
    const lines = [
      '# HELP http_requests_total Total HTTP requests handled by the API.',
      '# TYPE http_requests_total counter',
      ...renderCounter('http_requests_total', this.requests),
      '# HELP http_request_errors_total Total HTTP requests that returned 5xx.',
      '# TYPE http_request_errors_total counter',
      ...renderCounter('http_request_errors_total', this.errors),
      '# HELP http_request_duration_seconds HTTP request duration histogram.',
      '# TYPE http_request_duration_seconds histogram',
      ...renderDurationHistogram('http_request_duration_seconds', this.durations),
      '# HELP demo_transactions_total Total demo business transactions by outcome and dependency mode.',
      '# TYPE demo_transactions_total counter',
      ...renderCounter('demo_transactions_total', this.demoTransactions),
      '# HELP demo_transaction_duration_seconds Demo business transaction duration histogram.',
      '# TYPE demo_transaction_duration_seconds histogram',
      ...renderDurationHistogram(
        'demo_transaction_duration_seconds',
        this.demoTransactionDurations,
      ),
    ];

    return `${lines.join('\n')}\n`;
  }
}

function labelsKey(labels: Record<string, string>): string {
  return Object.entries(labels)
    .map(([key, value]) => `${key}="${escapeLabelValue(value)}"`)
    .join(',');
}

function recordDuration(
  values: Map<string, DurationAggregate>,
  labels: Record<string, string>,
  durationSeconds: number,
): void {
  const key = labelsKey(labels);
  const current = values.get(key) ?? {
    buckets: durationBucketsSeconds.map(() => 0),
    count: 0,
    labels,
    sum: 0,
  };
  const buckets = current.buckets.map((count, index) =>
    durationSeconds <= durationBucketsSeconds[index] ? count + 1 : count,
  );
  values.set(key, {
    buckets,
    count: current.count + 1,
    labels: current.labels,
    sum: current.sum + durationSeconds,
  });
}

function renderCounter(name: string, values: Map<string, number>): string[] {
  return [...values.entries()].map(([labels, value]) => `${name}{${labels}} ${value}`);
}

function renderDurationHistogram(name: string, values: Map<string, DurationAggregate>): string[] {
  return [...values.values()].flatMap((value) => {
    const labels = labelsKey(value.labels);

    return [
      ...value.buckets.map(
        (count, index) =>
          `${name}_bucket{${labels},le="${durationBucketsSeconds[index].toString()}"} ${count}`,
      ),
      `${name}_bucket{${labels},le="+Inf"} ${value.count}`,
      `${name}_count{${labels}} ${value.count}`,
      `${name}_sum{${labels}} ${value.sum.toFixed(6)}`,
    ];
  });
}

function durationDistributionSnapshots(
  metric: string,
  values: Map<string, DurationAggregate>,
): LatencyDistributionSnapshot[] {
  return [...values.values()].map((value) => {
    const meanSeconds = value.count === 0 ? 0 : value.sum / value.count;
    const p50 = histogramQuantileSeconds(value, 0.5);
    const p90 = histogramQuantileSeconds(value, 0.9);
    const p95 = histogramQuantileSeconds(value, 0.95);
    const p99 = histogramQuantileSeconds(value, 0.99);
    const meanMilliseconds = roundMilliseconds(meanSeconds);
    const p95Milliseconds = toMilliseconds(p95);

    return {
      count: value.count,
      labels: value.labels,
      meanMilliseconds,
      metric,
      quantilesMilliseconds: {
        p50: toMilliseconds(p50),
        p90: toMilliseconds(p90),
        p95: p95Milliseconds,
        p99: toMilliseconds(p99),
      },
      tailToMeanRatio:
        p95Milliseconds === null || meanMilliseconds === 0
          ? null
          : roundRatio(p95Milliseconds / meanMilliseconds),
    };
  });
}

function histogramQuantileSeconds(value: DurationAggregate, quantile: number): number | null {
  if (value.count === 0) {
    return null;
  }

  const rank = Math.ceil(value.count * quantile);
  const bucketIndex = value.buckets.findIndex((count) => count >= rank);

  return bucketIndex === -1 ? null : durationBucketsSeconds[bucketIndex];
}

function toMilliseconds(seconds: number | null): number | null {
  return seconds === null ? null : roundMilliseconds(seconds);
}

function roundMilliseconds(seconds: number): number {
  return Math.round(seconds * 100_000) / 100;
}

function roundRatio(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function escapeLabelValue(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('\n', '\\n').replaceAll('"', '\\"');
}
