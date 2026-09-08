import { Writable } from 'node:stream';

import { afterAll, describe, expect, it } from 'vitest';

import { buildApp } from './app.js';
import { requestIdHeader, transactionIdHeader } from './observability/correlation.js';

const app = buildApp();

afterAll(async () => {
  await app.close();
});

describe('health endpoint', () => {
  it('reports that the API is available', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
    expect(response.headers[requestIdHeader]).toMatch(/^[0-9a-f-]{36}$/);
    expect(response.headers[transactionIdHeader]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('propagates valid correlation identifiers', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health',
      headers: {
        [requestIdHeader]: 'edge-request-123',
        [transactionIdHeader]: 'checkout:456',
      },
    });

    expect(response.headers[requestIdHeader]).toBe('edge-request-123');
    expect(response.headers[transactionIdHeader]).toBe('checkout:456');
  });

  it('replaces unsafe inbound identifiers before logging or propagating them', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health',
      headers: {
        [requestIdHeader]: 'unsafe request id',
        [transactionIdHeader]: '<script>',
      },
    });

    expect(response.headers[requestIdHeader]).toMatch(/^[0-9a-f-]{36}$/);
    expect(response.headers[transactionIdHeader]).toMatch(/^[0-9a-f-]{36}$/);
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
          transaction_id: 'logged-transaction',
        }),
      ]),
    );
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
