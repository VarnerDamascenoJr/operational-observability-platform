import { randomBytes } from 'node:crypto';

export interface DemoTransactionTelemetry {
  asyncSpanId: string;
  asyncStepEndUnixNano: string;
  asyncStepStartUnixNano: string;
  asyncStepMilliseconds: number;
  correlationId: string;
  dependencyMode: string;
  dependencySpanId: string;
  dependencyEndUnixNano: string;
  dependencyStartUnixNano: string;
  durationMilliseconds: number;
  endUnixNano: string;
  outcome: 'error' | 'success';
  rootSpanId: string;
  simulatedDelayMilliseconds: number;
  startUnixNano: string;
  statusCode: number;
  traceId: string;
  transactionId: string;
}

export interface TelemetryExporter {
  exportDemoTransaction(sample: DemoTransactionTelemetry): Promise<void>;
}

interface TelemetryIdentity {
  environment: string;
  serviceName: string;
}

interface OtlpHttpTelemetryExporterOptions extends TelemetryIdentity {
  endpoint: string;
  timeoutMilliseconds?: number;
}

type OtlpAttributeValue =
  | {
      intValue: string;
    }
  | {
      stringValue: string;
    };

interface OtlpAttribute {
  key: string;
  value: OtlpAttributeValue;
}

export class NoopTelemetryExporter implements TelemetryExporter {
  exportDemoTransaction(): Promise<void> {
    return Promise.resolve();
  }
}

export class OtlpHttpTelemetryExporter implements TelemetryExporter {
  private readonly endpoint: string;
  private readonly identity: TelemetryIdentity;
  private readonly timeoutMilliseconds: number;

  constructor(options: OtlpHttpTelemetryExporterOptions) {
    this.endpoint = options.endpoint.replace(/\/$/, '');
    this.identity = {
      environment: options.environment,
      serviceName: options.serviceName,
    };
    this.timeoutMilliseconds = options.timeoutMilliseconds ?? 1_000;
  }

  async exportDemoTransaction(sample: DemoTransactionTelemetry): Promise<void> {
    await Promise.all([this.exportTrace(sample), this.exportLog(sample)]);
  }

  private exportTrace(sample: DemoTransactionTelemetry): Promise<void> {
    return this.post('/v1/traces', {
      resourceSpans: [
        {
          resource: {
            attributes: this.resourceAttributes(),
          },
          scopeSpans: [
            {
              scope: {
                name: 'operational-observability-platform/demo',
              },
              spans: [
                {
                  attributes: [
                    stringAttribute('transaction.id', sample.transactionId),
                    stringAttribute('correlation.id', sample.correlationId),
                    stringAttribute('demo.outcome', sample.outcome),
                    stringAttribute('demo.dependency_mode', sample.dependencyMode),
                    intAttribute('demo.async_step_ms', sample.asyncStepMilliseconds),
                    intAttribute('demo.simulated_delay_ms', sample.simulatedDelayMilliseconds),
                    intAttribute('http.response.status_code', sample.statusCode),
                  ],
                  endTimeUnixNano: sample.endUnixNano,
                  kind: 2,
                  name: 'demo.transaction',
                  spanId: sample.rootSpanId,
                  startTimeUnixNano: sample.startUnixNano,
                  status: otlpStatus(sample),
                  traceId: sample.traceId,
                },
                {
                  attributes: [intAttribute('demo.async_step_ms', sample.asyncStepMilliseconds)],
                  endTimeUnixNano: sample.asyncStepEndUnixNano,
                  kind: 1,
                  name: 'demo.async_step',
                  parentSpanId: sample.rootSpanId,
                  spanId: sample.asyncSpanId,
                  startTimeUnixNano: sample.asyncStepStartUnixNano,
                  status: {
                    code: 1,
                  },
                  traceId: sample.traceId,
                },
                {
                  attributes: [
                    stringAttribute('demo.dependency_mode', sample.dependencyMode),
                    intAttribute('demo.simulated_delay_ms', sample.simulatedDelayMilliseconds),
                  ],
                  endTimeUnixNano: sample.dependencyEndUnixNano,
                  kind: 3,
                  name: 'demo.external_dependency',
                  parentSpanId: sample.rootSpanId,
                  spanId: sample.dependencySpanId,
                  startTimeUnixNano: sample.dependencyStartUnixNano,
                  status: otlpStatus(sample),
                  traceId: sample.traceId,
                },
              ],
            },
          ],
        },
      ],
    });
  }

  private exportLog(sample: DemoTransactionTelemetry): Promise<void> {
    return this.post('/v1/logs', {
      resourceLogs: [
        {
          resource: {
            attributes: this.resourceAttributes(),
          },
          scopeLogs: [
            {
              scope: {
                name: 'operational-observability-platform/demo',
              },
              logRecords: [
                {
                  attributes: [
                    stringAttribute('correlation_id', sample.correlationId),
                    stringAttribute('transaction_id', sample.transactionId),
                    stringAttribute('trace_id', sample.traceId),
                    stringAttribute('demo.outcome', sample.outcome),
                    stringAttribute('demo.dependency_mode', sample.dependencyMode),
                    intAttribute('demo.duration_ms', sample.durationMilliseconds),
                    intAttribute('http.response.status_code', sample.statusCode),
                  ],
                  body: {
                    stringValue:
                      sample.outcome === 'success'
                        ? 'demo transaction completed'
                        : 'demo transaction failed',
                  },
                  severityText: sample.outcome === 'success' ? 'INFO' : 'WARN',
                  spanId: sample.rootSpanId,
                  timeUnixNano: sample.endUnixNano,
                  traceId: sample.traceId,
                },
              ],
            },
          ],
        },
      ],
    });
  }

  private async post(path: string, body: unknown): Promise<void> {
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
    }, this.timeoutMilliseconds);

    try {
      const response = await fetch(`${this.endpoint}${path}`, {
        body: JSON.stringify(body),
        headers: {
          'content-type': 'application/json',
        },
        method: 'POST',
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`OTLP export failed with HTTP ${response.status}`);
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  private resourceAttributes(): OtlpAttribute[] {
    return [
      stringAttribute('service.name', this.identity.serviceName),
      stringAttribute('deployment.environment', this.identity.environment),
    ];
  }
}

export function createTelemetryExporterFromEnv(
  env: NodeJS.ProcessEnv,
  identity: TelemetryIdentity,
): TelemetryExporter {
  if (env.OTEL_ENABLED !== 'true') {
    return new NoopTelemetryExporter();
  }

  return new OtlpHttpTelemetryExporter({
    endpoint: env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://localhost:4318',
    environment: identity.environment,
    serviceName: identity.serviceName,
  });
}

export function addMilliseconds(unixNano: string, milliseconds: number): string {
  return (BigInt(unixNano) + BigInt(milliseconds) * 1_000_000n).toString();
}

export function buildTraceparent(traceId: string, spanId: string): string {
  return `00-${traceId}-${spanId}-01`;
}

export function createTraceId(): string {
  return createNonZeroHex(16);
}

export function createSpanId(): string {
  return createNonZeroHex(8);
}

export function nowUnixNano(): string {
  return (BigInt(Date.now()) * 1_000_000n).toString();
}

function createNonZeroHex(bytes: number): string {
  let value = randomBytes(bytes).toString('hex');

  while (/^0+$/.test(value)) {
    value = randomBytes(bytes).toString('hex');
  }

  return value;
}

function intAttribute(key: string, value: number): OtlpAttribute {
  return {
    key,
    value: {
      intValue: Math.round(value).toString(),
    },
  };
}

function otlpStatus(sample: DemoTransactionTelemetry) {
  if (sample.statusCode >= 500) {
    return {
      code: 2,
      message: sample.outcome,
    };
  }

  return {
    code: 1,
  };
}

function stringAttribute(key: string, value: string): OtlpAttribute {
  return {
    key,
    value: {
      stringValue: value,
    },
  };
}
