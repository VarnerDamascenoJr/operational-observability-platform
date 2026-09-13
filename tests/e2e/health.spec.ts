import { expect, test } from '@playwright/test';

import {
  correlationIdHeader,
  requestIdHeader,
  transactionIdHeader,
  traceparentHeader,
} from '../../src/observability/correlation.js';

test('health endpoint is available through the running server', async ({ request }) => {
  const response = await request.get('/health');

  await expect(response).toBeOK();
  const body = (await response.json()) as {
    services: {
      postgres: {
        migrationsApplied: number;
      };
    };
  };
  expect(body).toEqual({
    services: {
      api: {
        status: 'ok',
      },
      postgres: {
        controlPlaneSchemaReady: true,
        coreTablesReady: true,
        database: 'observability',
        latencyMilliseconds: expect.any(Number),
        migrationsApplied: expect.any(Number),
        status: 'ok',
      },
    },
    status: 'ok',
  });
  expect(body.services.postgres.migrationsApplied).toBeGreaterThanOrEqual(2);
  expect(response.headers()[requestIdHeader]).toMatch(/^req_[0-9a-f-]{36}$/);
  expect(response.headers()[correlationIdHeader]).toMatch(/^corr_[0-9a-f-]{36}$/);
  expect(response.headers()[transactionIdHeader]).toMatch(/^txn_[0-9a-f-]{36}$/);
});

test('demo transaction supports success and controlled dependency failure', async ({ request }) => {
  const success = await request.get('/demo/transactions?delayMs=1&asyncMs=1', {
    headers: {
      [correlationIdHeader]: 'e2e-demo-correlation',
      [transactionIdHeader]: 'e2e-demo-transaction',
    },
  });

  await expect(success).toBeOK();
  await expect(success.json()).resolves.toEqual({
    asyncStepMs: 1,
    correlationId: 'e2e-demo-correlation',
    dependencyMode: 'normal',
    simulatedDelayMs: 1,
    status: 'succeeded',
    traceId: expect.stringMatching(/^[0-9a-f]{32}$/),
    traceparent: expect.stringMatching(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/),
    transactionId: 'e2e-demo-transaction',
  });
  expect(success.headers()[traceparentHeader]).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);

  const failure = await request.get('/demo/transactions?dependency=unavailable&asyncMs=1', {
    headers: {
      [correlationIdHeader]: 'e2e-failed-correlation',
      [transactionIdHeader]: 'e2e-failed-transaction',
    },
  });

  expect(failure.status()).toBe(503);
  await expect(failure.json()).resolves.toEqual({
    asyncStepMs: 1,
    correlationId: 'e2e-failed-correlation',
    dependencyMode: 'unavailable',
    simulatedDelayMs: 0,
    status: 'failed',
    traceId: expect.stringMatching(/^[0-9a-f]{32}$/),
    traceparent: expect.stringMatching(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/),
    transactionId: 'e2e-failed-transaction',
  });
});
