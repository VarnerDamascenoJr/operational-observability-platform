import type { FastifyInstance } from 'fastify';

import { traceparentHeader } from '../constants/headers.js';
import type { HttpMetrics } from '../observability/metrics.js';
import {
  buildTraceparent,
  createSpanId,
  createTraceId,
  nowUnixNano,
  type DemoTransactionTelemetry,
  type TelemetryExporter,
} from '../observability/otlp.js';

interface DemoRouteOptions {
  metrics: HttpMetrics;
  telemetry: TelemetryExporter;
}

export function registerDemoRoutes(app: FastifyInstance, options: DemoRouteOptions): void {
  app.get('/demo/transactions', async (request, reply) => {
    const query = request.query as {
      asyncMs?: string;
      delayMs?: string;
      dependency?: string;
      outcome?: string;
    };
    const asyncStepMilliseconds = boundedDelay(query.asyncMs, 10);
    const dependencyMode = normalizeDependencyMode(query.dependency);
    const requestedDelayMilliseconds = boundedDelay(query.delayMs);
    const simulatedDelayMilliseconds =
      dependencyMode === 'slow'
        ? Math.max(requestedDelayMilliseconds, 500)
        : requestedDelayMilliseconds;
    const traceId = request.traceId ?? createTraceId();
    const rootSpanId = createSpanId();
    const asyncSpanId = createSpanId();
    const dependencySpanId = createSpanId();
    const startUnixNano = nowUnixNano();
    const traceparent = buildTraceparent(traceId, rootSpanId);

    void reply.header(traceparentHeader, traceparent);

    const asyncStepStartUnixNano = nowUnixNano();
    await sleep(asyncStepMilliseconds);
    const asyncStepEndUnixNano = nowUnixNano();

    const dependencyStartUnixNano = nowUnixNano();
    await sleep(simulatedDelayMilliseconds);
    const dependencyEndUnixNano = nowUnixNano();
    const shouldFail = query.outcome === 'error' || dependencyMode === 'unavailable';
    const endUnixNano = nowUnixNano();
    const durationMilliseconds = Number(BigInt(endUnixNano) - BigInt(startUnixNano)) / 1_000_000;
    const outcome = shouldFail ? 'error' : 'success';
    const telemetrySample: DemoTransactionTelemetry = {
      asyncSpanId,
      asyncStepEndUnixNano,
      asyncStepStartUnixNano,
      asyncStepMilliseconds,
      correlationId: request.correlationId,
      dependencyEndUnixNano,
      dependencyMode,
      dependencySpanId,
      dependencyStartUnixNano,
      durationMilliseconds,
      endUnixNano,
      outcome,
      rootSpanId,
      simulatedDelayMilliseconds,
      startUnixNano,
      statusCode: shouldFail ? 503 : 200,
      traceId,
      transactionId: request.transactionId,
    };

    options.metrics.recordDemoTransaction({
      dependencyMode,
      durationSeconds: durationMilliseconds / 1_000,
      outcome,
    });

    if (shouldFail) {
      request.log.warn(
        {
          async_step_ms: asyncStepMilliseconds,
          dependency_mode: dependencyMode,
          operation: 'demo_transaction',
          outcome: 'error',
          simulated_delay_ms: simulatedDelayMilliseconds,
          span_id: rootSpanId,
          trace_id: traceId,
        },
        'demo transaction failed',
      );
      await exportDemoTelemetry(options.telemetry, telemetrySample, request.log);
      void reply.code(503);
      return {
        asyncStepMs: asyncStepMilliseconds,
        correlationId: request.correlationId,
        dependencyMode,
        simulatedDelayMs: simulatedDelayMilliseconds,
        status: 'failed',
        traceId,
        traceparent,
        transactionId: request.transactionId,
      };
    }

    request.log.info(
      {
        async_step_ms: asyncStepMilliseconds,
        dependency_mode: dependencyMode,
        operation: 'demo_transaction',
        outcome: 'success',
        simulated_delay_ms: simulatedDelayMilliseconds,
        span_id: rootSpanId,
        trace_id: traceId,
      },
      'demo transaction completed',
    );
    await exportDemoTelemetry(options.telemetry, telemetrySample, request.log);
    return {
      asyncStepMs: asyncStepMilliseconds,
      correlationId: request.correlationId,
      dependencyMode,
      simulatedDelayMs: simulatedDelayMilliseconds,
      status: 'succeeded',
      traceId,
      traceparent,
      transactionId: request.transactionId,
    };
  });
}

async function exportDemoTelemetry(
  telemetry: TelemetryExporter,
  sample: DemoTransactionTelemetry,
  log: { warn: (fields: Record<string, unknown>, message: string) => void },
): Promise<void> {
  try {
    await telemetry.exportDemoTransaction(sample);
  } catch (error) {
    log.warn(
      {
        error: error instanceof Error ? error.message : 'unknown telemetry export error',
        trace_id: sample.traceId,
      },
      'demo telemetry export failed',
    );
  }
}

function boundedDelay(value: string | undefined, defaultMilliseconds = 0): number {
  if (!value) {
    return defaultMilliseconds;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0;
  }
  return Math.min(parsed, 2_000);
}

function normalizeDependencyMode(value: string | undefined): 'normal' | 'slow' | 'unavailable' {
  if (value === 'slow' || value === 'unavailable') {
    return value;
  }

  return 'normal';
}

function sleep(milliseconds: number): Promise<void> {
  if (milliseconds <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}
