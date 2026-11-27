import { expect, test } from '@playwright/test';

test('sampling policy validates changes and rejects concurrent stale updates', async ({
  request,
}) => {
  const initialResponse = await request.get('/sampling/policy');
  await expect(initialResponse).toBeOK();
  const initial = (await initialResponse.json()) as {
    application: string;
    policy: { revision: number; latencyThresholdMs: number; healthySamplingPercentage: number };
  };
  expect(initial.application).toBe('manual');

  const invalid = await request.put('/sampling/policy', {
    data: {
      revision: initial.policy.revision,
      latencyThresholdMs: 500,
      healthySamplingPercentage: 101,
    },
  });
  expect(invalid.status()).toBe(400);
  const unsupported = await request.put('/sampling/policy', {
    data: {
      revision: initial.policy.revision,
      latencyThresholdMs: 300,
      healthySamplingPercentage: 20,
      errors: false,
    },
  });
  expect(unsupported.status()).toBe(400);

  const payload = {
    revision: initial.policy.revision,
    latencyThresholdMs: 250,
    healthySamplingPercentage: 25,
  };
  const responses = await Promise.all([
    request.put('/sampling/policy', { data: payload }),
    request.put('/sampling/policy', { data: payload }),
  ]);
  expect(responses.map((response) => response.status()).sort()).toEqual([200, 409]);
  const fetched = await request.get('/sampling/policy');
  const current = (await fetched.json()) as { policy: typeof payload };
  expect(current.policy).toMatchObject({ ...payload, revision: payload.revision + 1 });

  const restored = await request.put('/sampling/policy', {
    data: {
      revision: current.policy.revision,
      latencyThresholdMs: initial.policy.latencyThresholdMs,
      healthySamplingPercentage: initial.policy.healthySamplingPercentage,
    },
  });
  await expect(restored).toBeOK();
});
