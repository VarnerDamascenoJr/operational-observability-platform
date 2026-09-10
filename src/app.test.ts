import { Writable } from 'node:stream';

import { afterAll, describe, expect, it } from 'vitest';

import { buildApp } from './app.js';
import {
  correlationIdHeader,
  requestIdHeader,
  transactionIdHeader,
} from './observability/correlation.js';

const app = buildApp();

afterAll(async () => {
  await app.close();
});

describe('health endpoint', () => {
  it('reports that the API is available', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.headers['x-request-id']).toMatch(/^req_/);
    expect(response.headers['x-correlation-id']).toMatch(/^corr_/);
    expect(response.json()).toEqual({ status: 'ok' });
    expect(response.headers[transactionIdHeader]).toMatch(/^txn_/);
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
    const response = await app.inject({
      method: 'GET',
      url: '/demo/transactions?delayMs=1',
      headers: {
        [correlationIdHeader]: 'demo-correlation',
        [transactionIdHeader]: 'demo-transaction',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: 'succeeded',
      transactionId: 'demo-transaction',
      correlationId: 'demo-correlation',
      simulatedDelayMs: 1,
    });
  });

  it('emits a controlled failure for incident demonstrations', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/demo/transactions?outcome=error',
      headers: {
        [correlationIdHeader]: 'failed-correlation',
        [transactionIdHeader]: 'failed-transaction',
      },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      status: 'failed',
      transactionId: 'failed-transaction',
      correlationId: 'failed-correlation',
      simulatedDelayMs: 0,
    });
  });

  it('exports RED metrics in Prometheus text format', async () => {
    await app.inject({ method: 'GET', url: '/demo/transactions' });
    await app.inject({ method: 'GET', url: '/demo/transactions?outcome=error' });

    const response = await app.inject({ method: 'GET', url: '/metrics' });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('http_requests_total');
    expect(response.body).toContain('http_request_errors_total');
    expect(response.body).toContain('http_request_duration_seconds_count');
    expect(response.body).toContain('route="/demo/transactions"');
    expect(response.body).toContain('status="503"');
  });
});
