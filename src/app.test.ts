import { Writable } from 'node:stream';

import type { QueryResult, QueryResultRow } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';

import { buildApp } from './app.js';
import type { SqlExecutor } from './database/postgres.js';
import {
  correlationIdHeader,
  requestIdHeader,
  transactionIdHeader,
  traceparentHeader,
} from './observability/correlation.js';
import type { DemoTransactionTelemetry, TelemetryExporter } from './observability/otlp.js';

const app = buildApp({ database: createHealthyDatabase() });

afterAll(async () => {
  await app.close();
});

describe('health endpoint', () => {
  it('reports that the API and PostgreSQL are available', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.headers['x-request-id']).toMatch(/^req_/);
    expect(response.headers['x-correlation-id']).toMatch(/^corr_/);
    expect(response.json()).toEqual({
      services: {
        api: {
          status: 'ok',
        },
        postgres: {
          controlPlaneSchemaReady: true,
          coreTablesReady: true,
          database: 'observability_test',
          latencyMilliseconds: expect.any(Number),
          migrationsApplied: 2,
          status: 'ok',
        },
      },
      status: 'ok',
    });
    expect(response.headers[transactionIdHeader]).toMatch(/^txn_/);
  });

  it('reports degraded health when PostgreSQL cannot be queried', async () => {
    const unhealthyApp = buildApp({ database: createFailingDatabase() });
    const response = await unhealthyApp.inject({ method: 'GET', url: '/health' });
    await unhealthyApp.close();

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      services: {
        api: {
          status: 'ok',
        },
        postgres: {
          error: 'PostgreSQL health query failed',
          status: 'error',
        },
      },
      status: 'degraded',
    });
  });

  it('propagates valid correlation identifiers', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health',
      headers: {
        [requestIdHeader]: 'edge-request-123',
        [correlationIdHeader]: 'checkout-flow',
        [transactionIdHeader]: 'checkout:456',
      },
    });

    expect(response.headers[requestIdHeader]).toBe('edge-request-123');
    expect(response.headers[correlationIdHeader]).toBe('checkout-flow');
    expect(response.headers[transactionIdHeader]).toBe('checkout:456');
  });

  it('replaces unsafe inbound identifiers before logging or propagating them', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health',
      headers: {
        [requestIdHeader]: 'unsafe request id',
        [correlationIdHeader]: '<script>',
        [transactionIdHeader]: '<script>',
      },
    });

    expect(response.headers[requestIdHeader]).toMatch(/^req_/);
    expect(response.headers[correlationIdHeader]).toMatch(/^corr_/);
    expect(response.headers[transactionIdHeader]).toMatch(/^txn_/);
  });

  it('adds the correlation contract to structured request logs', async () => {
    const lines: string[] = [];
    const loggerStream = new Writable({
      write(chunk, _encoding, callback) {
        lines.push(chunk.toString());
        callback();
      },
    });
    const loggedApp = buildApp({ loggerStream });

    await loggedApp.inject({
      method: 'GET',
      url: '/health',
      headers: {
        [requestIdHeader]: 'logged-request',
        [correlationIdHeader]: 'logged-correlation',
        [transactionIdHeader]: 'logged-transaction',
        [traceparentHeader]: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
      },
    });
    await loggedApp.close();

    const logEntries = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(logEntries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          service_name: 'operational-observability-platform',
          environment: process.env.NODE_ENV ?? 'development',
          request_id: 'logged-request',
          correlation_id: 'logged-correlation',
          trace_id: '4bf92f3577b34da6a3ce929d0e0e4736',
          transaction_id: 'logged-transaction',
        }),
      ]),
    );
  });

  it('preserves incoming correlation headers', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health',
      headers: {
        'x-request-id': 'req-demo',
        'x-correlation-id': 'corr-demo',
        'x-transaction-id': 'transaction-demo',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['x-request-id']).toBe('req-demo');
    expect(response.headers['x-correlation-id']).toBe('corr-demo');
    expect(response.headers['x-transaction-id']).toBe('transaction-demo');
  });

  it('normalizes blank correlation headers', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health',
      headers: {
        'x-request-id': ' ',
        'x-correlation-id': '\t',
        'x-transaction-id': '',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['x-request-id']).toMatch(/^req_/);
    expect(response.headers['x-correlation-id']).toMatch(/^corr_/);
    expect(response.headers['x-transaction-id']).toMatch(/^txn_/);
  });

  it('enables readable logs during local development', async () => {
    const nodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    const developmentApp = buildApp();

    await developmentApp.ready();
    await developmentApp.close();
    process.env.NODE_ENV = nodeEnv;
  });
});

describe('demo transaction endpoint', () => {
  it('emits a correlated successful transaction response', async () => {
    const telemetry = new CapturingTelemetryExporter();
    const demoApp = buildApp({ database: createHealthyDatabase(), telemetry });
    const response = await demoApp.inject({
      method: 'GET',
      url: '/demo/transactions?delayMs=1&asyncMs=1',
      headers: {
        [correlationIdHeader]: 'demo-correlation',
        [transactionIdHeader]: 'demo-transaction',
      },
    });
    await demoApp.close();

    expect(response.statusCode).toBe(200);
    const body = response.json() as Record<string, unknown>;
    expect(body).toEqual({
      asyncStepMs: 1,
      correlationId: 'demo-correlation',
      dependencyMode: 'normal',
      simulatedDelayMs: 1,
      status: 'succeeded',
      traceId: expect.stringMatching(/^[0-9a-f]{32}$/),
      traceparent: expect.stringMatching(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/),
      transactionId: 'demo-transaction',
    });
    expect(response.headers[traceparentHeader]).toBe(body.traceparent);
    expect(telemetry.samples).toHaveLength(1);
    expect(telemetry.samples[0]).toEqual(
      expect.objectContaining({
        correlationId: 'demo-correlation',
        outcome: 'success',
        statusCode: 200,
        transactionId: 'demo-transaction',
      }),
    );
  });

  it('emits a controlled failure for incident demonstrations', async () => {
    const telemetry = new CapturingTelemetryExporter();
    const demoApp = buildApp({ database: createHealthyDatabase(), telemetry });
    const response = await demoApp.inject({
      method: 'GET',
      url: '/demo/transactions?dependency=unavailable',
      headers: {
        [correlationIdHeader]: 'failed-correlation',
        [transactionIdHeader]: 'failed-transaction',
      },
    });
    await demoApp.close();

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      asyncStepMs: 10,
      correlationId: 'failed-correlation',
      dependencyMode: 'unavailable',
      simulatedDelayMs: 0,
      status: 'failed',
      traceId: expect.stringMatching(/^[0-9a-f]{32}$/),
      traceparent: expect.stringMatching(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/),
      transactionId: 'failed-transaction',
    });
    expect(telemetry.samples).toHaveLength(1);
    expect(telemetry.samples[0]).toEqual(
      expect.objectContaining({
        correlationId: 'failed-correlation',
        dependencyMode: 'unavailable',
        outcome: 'error',
        statusCode: 503,
        transactionId: 'failed-transaction',
      }),
    );
  });

  it('exports technical RED and demo business metrics in Prometheus text format', async () => {
    await app.inject({ method: 'GET', url: '/demo/transactions' });
    await app.inject({ method: 'GET', url: '/demo/transactions?outcome=error' });
    await app.inject({
      method: 'GET',
      url: '/demo/transactions?dependency=slow&delayMs=1&asyncMs=1',
    });

    const response = await app.inject({ method: 'GET', url: '/metrics' });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('http_requests_total');
    expect(response.body).toContain('http_request_errors_total');
    expect(response.body).toContain('http_request_duration_seconds_count');
    expect(response.body).toContain('route="/demo/transactions"');
    expect(response.body).toContain('status="503"');
    expect(response.body).toContain('demo_transactions_total');
    expect(response.body).toContain('demo_transaction_duration_seconds_count');
    expect(response.body).toContain('outcome="success"');
    expect(response.body).toContain('outcome="error"');
    expect(response.body).toContain('dependency_mode="slow"');
  });
});

function createHealthyDatabase(): SqlExecutor {
  return {
    async query<Row extends QueryResultRow = QueryResultRow>() {
      return queryResult<Row>([
        {
          control_plane_schema_ready: true,
          core_tables_ready: true,
          database_name: 'observability_test',
          migrations_applied: 2,
        } as unknown as Row,
      ]);
    },
  };
}

class CapturingTelemetryExporter implements TelemetryExporter {
  readonly samples: DemoTransactionTelemetry[] = [];

  exportDemoTransaction(sample: DemoTransactionTelemetry): Promise<void> {
    this.samples.push(sample);
    return Promise.resolve();
  }
}

function createFailingDatabase(): SqlExecutor {
  return {
    async query() {
      throw new Error('database offline');
    },
  };
}

function queryResult<Row extends QueryResultRow>(rows: Row[]): QueryResult<Row> {
  return {
    command: 'SELECT',
    fields: [],
    oid: 0,
    rowCount: rows.length,
    rows,
  };
}
