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

test('SLO API configures objectives and calculates error budget state', async ({ request }) => {
  const createResponse = await request.post('/slos', {
    data: {
      project: {
        slug: 'portfolio-observability',
        name: 'Portfolio Observability',
      },
      service: {
        slug: 'operational-observability-platform',
        name: 'Operational Observability Platform',
        environment: 'e2e',
        owner: 'platform',
      },
      slug: 'demo-transaction-slo',
      name: 'Demo transaction SLO',
      description: 'Demonstrates availability, latency and error budget calculations.',
      windowDays: 7,
      objectives: [
        {
          type: 'availability',
          targetPercentage: 99,
        },
        {
          type: 'latency',
          targetPercentage: 95,
          latencyThresholdMilliseconds: 500,
        },
      ],
    },
  });

  expect(createResponse.status()).toBe(201);
  const created = (await createResponse.json()) as {
    id: string;
    objectives: Array<{ type: string }>;
    slug: string;
  };
  expect(created.slug).toBe('demo-transaction-slo');
  expect(created.objectives.map((objective) => objective.type).sort()).toEqual([
    'availability',
    'latency',
  ]);

  const listResponse = await request.get('/slos');

  await expect(listResponse).toBeOK();
  await expect(listResponse.json()).resolves.toEqual(
    expect.objectContaining({
      slos: expect.arrayContaining([expect.objectContaining({ slug: 'demo-transaction-slo' })]),
    }),
  );

  const earlierEvaluationResponse = await request.post(`/slos/${created.id}/evaluations`, {
    data: {
      windowStartedAt: '2026-09-12T00:00:00.000Z',
      windowEndedAt: '2026-09-13T00:00:00.000Z',
      indicators: {
        availability: {
          totalEvents: 1_000,
          goodEvents: 990,
        },
        latency: {
          totalEvents: 1_000,
          goodEvents: 980,
        },
      },
      source: {
        kind: 'fixture',
        period: '1d',
        query: 'fixtures/slo/demo-transaction-windows.json',
      },
    },
  });

  expect(earlierEvaluationResponse.status()).toBe(201);

  const evaluationResponse = await request.post(`/slos/${created.id}/evaluations`, {
    data: {
      windowStartedAt: '2026-09-13T00:00:00.000Z',
      windowEndedAt: '2026-09-14T00:00:00.000Z',
      indicators: {
        availability: {
          totalEvents: 1_000,
          goodEvents: 995,
        },
        latency: {
          totalEvents: 1_000,
          goodEvents: 940,
        },
      },
      source: {
        kind: 'fixture',
        period: '1d',
        query: 'fixtures/slo/demo-transaction-windows.json',
      },
    },
  });

  expect(evaluationResponse.status()).toBe(201);
  const evaluation = (await evaluationResponse.json()) as {
    objectives: Array<{
      errorBudgetConsumedPercentage: number;
      observedPercentage: number;
      status: string;
      type: string;
    }>;
    overallStatus: string;
  };
  expect(evaluation.overallStatus).toBe('breached');
  expect(evaluation.objectives).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        errorBudgetConsumedPercentage: 50,
        observedPercentage: 99.5,
        status: 'ok',
        type: 'availability',
      }),
      expect.objectContaining({
        errorBudgetConsumedPercentage: 120,
        observedPercentage: 94,
        status: 'breached',
        type: 'latency',
      }),
    ]),
  );

  const statusResponse = await request.get(`/slos/${created.id}/status`);

  await expect(statusResponse).toBeOK();
  await expect(statusResponse.json()).resolves.toEqual(
    expect.objectContaining({
      overallStatus: 'breached',
      slo: expect.objectContaining({ slug: 'demo-transaction-slo' }),
      window: {
        startedAt: '2026-09-13T00:00:00.000Z',
        endedAt: '2026-09-14T00:00:00.000Z',
      },
    }),
  );

  const rollingWindowsResponse = await request.get(`/slos/${created.id}/rolling-windows?limit=2`);

  await expect(rollingWindowsResponse).toBeOK();
  await expect(rollingWindowsResponse.json()).resolves.toEqual(
    expect.objectContaining({
      limit: 2,
      overallStatus: 'breached',
      objectives: expect.arrayContaining([
        expect.objectContaining({
          summary: expect.objectContaining({
            averageObservedPercentage: 99.25,
            breachedWindows: 0,
            evaluatedWindows: 2,
            latestStatus: 'ok',
            latestWindowEndedAt: '2026-09-14T00:00:00.000Z',
            maxErrorBudgetConsumedPercentage: 100,
            minObservedPercentage: 99,
            totalBadEvents: 15,
            totalEvents: 2_000,
            totalGoodEvents: 1_985,
          }),
          type: 'availability',
          windows: [
            expect.objectContaining({
              endedAt: '2026-09-13T00:00:00.000Z',
              observedPercentage: 99,
              source: {
                kind: 'fixture',
                period: '1d',
                query: 'fixtures/slo/demo-transaction-windows.json',
              },
              status: 'ok',
            }),
            expect.objectContaining({
              endedAt: '2026-09-14T00:00:00.000Z',
              observedPercentage: 99.5,
              source: {
                kind: 'fixture',
                period: '1d',
                query: 'fixtures/slo/demo-transaction-windows.json',
              },
              status: 'ok',
            }),
          ],
        }),
        expect.objectContaining({
          summary: expect.objectContaining({
            breachedWindows: 1,
            evaluatedWindows: 2,
            latestStatus: 'breached',
            maxErrorBudgetConsumedPercentage: 120,
            minObservedPercentage: 94,
          }),
          type: 'latency',
        }),
      ]),
    }),
  );

  const burnRateResponse = await request.get(
    `/slos/${created.id}/burn-rate?shortWindows=1&longWindows=2`,
  );

  await expect(burnRateResponse).toBeOK();
  await expect(burnRateResponse.json()).resolves.toEqual(
    expect.objectContaining({
      longWindowCount: 2,
      overallSeverity: 'page',
      shortWindowCount: 1,
      objectives: expect.arrayContaining([
        expect.objectContaining({
          longWindow: expect.objectContaining({
            burnRate: 2.625,
            errorBudgetConsumedPercentage: 75,
            expectedBudgetConsumedPercentage: 28.571,
          }),
          severity: 'warning',
          shortWindow: expect.objectContaining({
            burnRate: 3.5,
            errorBudgetConsumedPercentage: 50,
          }),
          type: 'availability',
        }),
        expect.objectContaining({
          longWindow: expect.objectContaining({
            burnRate: 2.8,
            errorBudgetConsumedPercentage: 80,
            expectedBudgetConsumedPercentage: 28.571,
          }),
          severity: 'page',
          shortWindow: expect.objectContaining({
            burnRate: 8.4,
            errorBudgetConsumedPercentage: 120,
          }),
          type: 'latency',
        }),
      ]),
    }),
  );
});

test('incident API preserves guided investigation state from alert to resolution', async ({
  request,
}) => {
  const sloResponse = await request.post('/slos', {
    data: {
      project: {
        slug: 'portfolio-observability',
        name: 'Portfolio Observability',
      },
      service: {
        slug: 'operational-observability-platform',
        name: 'Operational Observability Platform',
        environment: 'e2e',
        owner: 'platform',
      },
      slug: 'incident-demo-slo',
      name: 'Incident demo SLO',
      windowDays: 7,
      objectives: [
        {
          type: 'availability',
          targetPercentage: 99,
        },
      ],
    },
  });
  expect(sloResponse.status()).toBe(201);
  const slo = (await sloResponse.json()) as { id: string };

  const createIncidentResponse = await request.post('/incidents', {
    data: {
      project: {
        slug: 'portfolio-observability',
        name: 'Portfolio Observability',
      },
      service: {
        slug: 'operational-observability-platform',
        name: 'Operational Observability Platform',
        environment: 'e2e',
        owner: 'platform',
      },
      severity: 'page',
      sloId: slo.id,
      sourceAlert: {
        fingerprint: 'alert-fingerprint-e2e',
        name: 'OOPSloErrorBudgetBurn',
        severity: 'page',
      },
      summary: 'The demo service spent its error budget during the e2e window.',
      title: 'Demo transaction SLO burn',
      evidence: [
        {
          title: 'Business dashboard breach panel',
          type: 'dashboard',
          url: 'http://localhost:3001/d/oop-demo-business',
        },
      ],
      hypotheses: [
        {
          confidence: 'medium',
          statement: 'The dependency unavailable mode is driving user-visible failures.',
        },
      ],
    },
  });

  expect(createIncidentResponse.status()).toBe(201);
  const created = (await createIncidentResponse.json()) as {
    evidence: Array<{ title: string; type: string }>;
    hypotheses: Array<{ statement: string }>;
    id: string;
    sloId: string;
    sourceAlert: { name: string };
    status: string;
    timeline: Array<{ type: string }>;
  };
  expect(created.status).toBe('open');
  expect(created.sloId).toBe(slo.id);
  expect(created.sourceAlert.name).toBe('OOPSloErrorBudgetBurn');
  expect(created.evidence).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ title: 'OOPSloErrorBudgetBurn', type: 'alert' }),
      expect.objectContaining({ title: 'Business dashboard breach panel', type: 'dashboard' }),
    ]),
  );
  expect(created.hypotheses).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        statement: 'The dependency unavailable mode is driving user-visible failures.',
      }),
    ]),
  );
  expect(created.timeline).toEqual(
    expect.arrayContaining([expect.objectContaining({ type: 'opened' })]),
  );

  const investigatingResponse = await request.patch(`/incidents/${created.id}`, {
    data: {
      status: 'investigating',
      summary: 'Responder confirmed user impact and started trace/log investigation.',
    },
  });

  await expect(investigatingResponse).toBeOK();
  await expect(investigatingResponse.json()).resolves.toEqual(
    expect.objectContaining({
      status: 'investigating',
      summary: 'Responder confirmed user impact and started trace/log investigation.',
    }),
  );

  const evidenceResponse = await request.post(`/incidents/${created.id}/evidence`, {
    data: {
      description: 'Trace shows the unavailable dependency span failing before the 503.',
      title: 'Tempo trace for failed transaction',
      type: 'trace',
      url: 'http://localhost:3200/api/traces/abcdefabcdefabcdefabcdefabcdefab',
    },
  });
  expect(evidenceResponse.status()).toBe(201);

  const resolvedResponse = await request.patch(`/incidents/${created.id}`, {
    data: {
      preventiveActions: 'Keep the dependency unavailable runbook linked from the alert.',
      rootCause: 'Controlled unavailable dependency mode exhausted the demonstration SLO.',
      status: 'resolved',
    },
  });

  await expect(resolvedResponse).toBeOK();
  const resolved = (await resolvedResponse.json()) as {
    preventiveActions: string;
    resolvedAt: string;
    rootCause: string;
    status: string;
    timeline: Array<{ title: string; type: string }>;
  };
  expect(resolved.status).toBe('resolved');
  expect(resolved.resolvedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  expect(resolved.rootCause).toBe(
    'Controlled unavailable dependency mode exhausted the demonstration SLO.',
  );
  expect(resolved.preventiveActions).toBe(
    'Keep the dependency unavailable runbook linked from the alert.',
  );
  expect(resolved.timeline).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ title: 'Incident resolved', type: 'resolved' }),
    ]),
  );
});
