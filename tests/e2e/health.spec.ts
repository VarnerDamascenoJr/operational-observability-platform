import { expect, test } from '@playwright/test';

test('health endpoint is available through the running server', async ({ request }) => {
  const response = await request.get('/health');

  await expect(response).toBeOK();
  await expect(response.json()).resolves.toEqual({ status: 'ok' });
});
