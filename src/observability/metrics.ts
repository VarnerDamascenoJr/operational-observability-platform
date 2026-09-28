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
  sum: number;
}

const durationBucketsSeconds = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

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
    const key = labelsKey({
      service: this.identity.service,
      environment: this.identity.environment,
      method: sample.method,
      route: sample.route,
      status: String(sample.statusCode),
    });
    this.requests.set(key, (this.requests.get(key) ?? 0) + 1);

    if (sample.statusCode >= 500) {
      this.errors.set(key, (this.errors.get(key) ?? 0) + 1);
    }

    recordDuration(this.durations, key, sample.durationSeconds);
  }

  recordDemoTransaction(sample: DemoTransactionMetricSample): void {
    const key = labelsKey({
      service: this.identity.service,
      environment: this.identity.environment,
      outcome: sample.outcome,
      dependency_mode: sample.dependencyMode,
    });
    this.demoTransactions.set(key, (this.demoTransactions.get(key) ?? 0) + 1);
    recordDuration(this.demoTransactionDurations, key, sample.durationSeconds);
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
      ...renderDurationHistogram('demo_transaction_duration_seconds', this.demoTransactionDurations),
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
  key: string,
  durationSeconds: number,
): void {
  const current =
    values.get(key) ?? { buckets: durationBucketsSeconds.map(() => 0), count: 0, sum: 0 };
  const buckets = current.buckets.map((count, index) =>
    durationSeconds <= durationBucketsSeconds[index] ? count + 1 : count,
  );
  values.set(key, {
    buckets,
    count: current.count + 1,
    sum: current.sum + durationSeconds,
  });
}

function renderCounter(name: string, values: Map<string, number>): string[] {
  return [...values.entries()].map(([labels, value]) => `${name}{${labels}} ${value}`);
}

function renderDurationHistogram(name: string, values: Map<string, DurationAggregate>): string[] {
  return [...values.entries()].flatMap(([labels, value]) => [
    ...value.buckets.map(
      (count, index) =>
        `${name}_bucket{${labels},le="${durationBucketsSeconds[index].toString()}"} ${count}`,
    ),
    `${name}_bucket{${labels},le="+Inf"} ${value.count}`,
    `${name}_count{${labels}} ${value.count}`,
    `${name}_sum{${labels}} ${value.sum.toFixed(6)}`,
  ]);
}

function escapeLabelValue(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('\n', '\\n').replaceAll('"', '\\"');
}
