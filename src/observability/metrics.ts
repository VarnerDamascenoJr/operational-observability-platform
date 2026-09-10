export interface HttpMetricSample {
  method: string;
  route: string;
  statusCode: number;
  durationSeconds: number;
}

interface MetricsIdentity {
  service: string;
  environment: string;
}

interface DurationAggregate {
  count: number;
  sum: number;
}

export class HttpMetrics {
  private readonly identity: MetricsIdentity;
  private readonly requests = new Map<string, number>();
  private readonly errors = new Map<string, number>();
  private readonly durations = new Map<string, DurationAggregate>();

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

    const current = this.durations.get(key) ?? { count: 0, sum: 0 };
    this.durations.set(key, {
      count: current.count + 1,
      sum: current.sum + sample.durationSeconds,
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
      '# HELP http_request_duration_seconds HTTP request duration summary.',
      '# TYPE http_request_duration_seconds summary',
      ...renderDurationSummary('http_request_duration_seconds', this.durations),
    ];

    return `${lines.join('\n')}\n`;
  }
}

function labelsKey(labels: Record<string, string>): string {
  return Object.entries(labels)
    .map(([key, value]) => `${key}="${escapeLabelValue(value)}"`)
    .join(',');
}

function renderCounter(name: string, values: Map<string, number>): string[] {
  return [...values.entries()].map(([labels, value]) => `${name}{${labels}} ${value}`);
}

function renderDurationSummary(name: string, values: Map<string, DurationAggregate>): string[] {
  return [...values.entries()].flatMap(([labels, value]) => [
    `${name}_count{${labels}} ${value.count}`,
    `${name}_sum{${labels}} ${value.sum.toFixed(6)}`,
  ]);
}

function escapeLabelValue(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('\n', '\\n').replaceAll('"', '\\"');
}
