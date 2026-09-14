import { expect, test } from '@playwright/test';

import {
  correlationIdHeader,
  requestIdHeader,
  transactionIdHeader,
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
