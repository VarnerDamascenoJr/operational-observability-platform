import { expect, test } from '@playwright/test';

import { requestIdHeader, transactionIdHeader } from '../../src/observability/correlation.js';

test('health endpoint is available through the running server', async ({ request }) => {
  const response = await request.get('/health');

  await expect(response).toBeOK();
  await expect(response.json()).resolves.toEqual({ status: 'ok' });
  expect(response.headers()[requestIdHeader]).toMatch(/^[0-9a-f-]{36}$/);
  expect(response.headers()[transactionIdHeader]).toMatch(/^[0-9a-f-]{36}$/);
});
