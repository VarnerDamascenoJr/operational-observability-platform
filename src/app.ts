import type { Writable } from 'node:stream';

import helmet from '@fastify/helmet';
import sensible from '@fastify/sensible';
import Fastify, { LogController } from 'fastify';
import type { QueryResultRow } from 'pg';

import type { SqlExecutor } from './database/postgres.js';
import {
  correlationIdHeader,
  getCorrelationContext,
  requestIdHeader,
  transactionIdHeader,
  traceparentHeader,
} from './observability/correlation.js';
import { registerIncidentRoutes } from './incidents.js';
import { HttpMetrics } from './observability/metrics.js';
import { registerSloRoutes, renderSloPrometheusMetrics } from './slo.js';
import {
  buildTraceparent,
  createSpanId,
  createTraceId,
  NoopTelemetryExporter,
  nowUnixNano,
  type DemoTransactionTelemetry,
  type TelemetryExporter,
} from './observability/otlp.js';

declare module 'fastify' {
  interface FastifyRequest {
    correlationId: string;
    observedRoute: string;
    startedAtNanoseconds: bigint;
    traceId?: string;
    transactionId: string;
  }
}

interface BuildAppOptions {
  closeDatabase?: () => Promise<void>;
  database?: SqlExecutor;
  loggerStream?: Writable;
  metrics?: HttpMetrics;
  telemetry?: TelemetryExporter;
}

interface PostgresHealthRow extends QueryResultRow {
  control_plane_schema_ready: boolean;
  core_tables_ready: boolean;
  database_name: string;
  migrations_applied: number;
}

type PostgresHealth =
  | {
      status: 'ok';
      controlPlaneSchemaReady: true;
      coreTablesReady: true;
      database: string;
      latencyMilliseconds: number;
      migrationsApplied: number;
    }
  | {
      status: 'error';
      controlPlaneSchemaReady?: boolean;
      coreTablesReady?: boolean;
      database?: string;
      error: string;
      latencyMilliseconds?: number;
      migrationsApplied?: number;
    }
  | {
      status: 'not_configured';
    };

interface HealthResponse {
  services: {
    api: {
      status: 'ok';
    };
    postgres: PostgresHealth;
  };
  status: 'degraded' | 'ok';
}

export function buildApp(options: BuildAppOptions = {}) {
  const environment = process.env.NODE_ENV ?? 'development';
  const serviceName = 'operational-observability-platform';
  const metrics = options.metrics ?? new HttpMetrics({ service: serviceName, environment });
  const telemetry = options.telemetry ?? new NoopTelemetryExporter();
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
      base: {
        service_name: serviceName,
        environment,
      },
      transport:
        environment === 'development' && !options.loggerStream
          ? { target: 'pino-pretty' }
          : undefined,
      stream: options.loggerStream,
    },
    genReqId: (request) => getCorrelationContext(request).requestId,
    logController: new LogController({ requestIdLogLabel: 'request_id' }),
    childLoggerFactory(logger, bindings, childLoggerOptions, request) {
      const context = getCorrelationContext(request);

      return logger.child(
        {
          ...bindings,
          correlation_id: context.correlationId,
          ...(context.traceId ? { trace_id: context.traceId } : {}),
          transaction_id: context.transactionId,
        },
        childLoggerOptions,
      );
    },
  });

  void app.register(helmet);
  void app.register(sensible);
  app.decorateRequest('correlationId', '');
  app.decorateRequest('observedRoute', '');
  app.decorateRequest('startedAtNanoseconds', 0n);
  app.decorateRequest('traceId');
  app.decorateRequest('transactionId', '');

  if (options.closeDatabase) {
    app.addHook('onClose', async () => {
      await options.closeDatabase?.();
    });
  }

  app.addHook('onRequest', async (request, reply) => {
    const context = getCorrelationContext(request.raw);
    request.correlationId = context.correlationId;
    request.startedAtNanoseconds = process.hrtime.bigint();
    request.traceId = context.traceId;
    request.transactionId = context.transactionId;
    void reply.header(requestIdHeader, context.requestId);
    void reply.header(correlationIdHeader, context.correlationId);
    void reply.header(transactionIdHeader, context.transactionId);
  });

  app.addHook('preHandler', async (request) => {
    request.observedRoute = request.routeOptions.url ?? request.url;
  });

  app.addHook('onResponse', async (request, reply) => {
    const elapsedNanoseconds = process.hrtime.bigint() - request.startedAtNanoseconds;
    metrics.record({
      method: request.method,
      route: request.observedRoute || request.url,
      statusCode: reply.statusCode,
      durationSeconds: Number(elapsedNanoseconds) / 1_000_000_000,
    });
  });

  app.get('/health', async (_request, reply) => {
    const postgres = await checkPostgres(options.database);
    const response: HealthResponse = {
      services: {
        api: {
          status: 'ok',
        },
        postgres,
      },
      status: postgres.status === 'ok' ? 'ok' : 'degraded',
    };

    if (response.status === 'degraded') {
      void reply.code(503);
    }

    return response;
  });
  app.get('/metrics', async (request, reply) => {
    void reply.type('text/plain; version=0.0.4; charset=utf-8');

    let sloMetrics = '';

    if (options.database) {
      try {
        sloMetrics = await renderSloPrometheusMetrics(options.database);
      } catch (error) {
        request.log.warn(
          {
            error: error instanceof Error ? error.message : 'unknown SLO metrics error',
          },
          'slo metrics rendering failed',
        );
      }
    }

    return `${metrics.renderPrometheus()}${sloMetrics}`;
  });

  registerSloRoutes(app, options.database);
  registerIncidentRoutes(app, options.database);
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

    metrics.recordDemoTransaction({
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
      await exportDemoTelemetry(telemetry, telemetrySample, request.log);
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
    await exportDemoTelemetry(telemetry, telemetrySample, request.log);
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

  return app;
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

async function checkPostgres(database: SqlExecutor | undefined): Promise<PostgresHealth> {
  if (!database) {
    return {
      status: 'not_configured',
    };
  }

  const startedAt = process.hrtime.bigint();

  try {
    const result = await database.query<PostgresHealthRow>(`
      SELECT
        current_database() AS database_name,
        EXISTS (
          SELECT 1
          FROM information_schema.schemata
          WHERE schema_name = 'control_plane'
        ) AS control_plane_schema_ready,
        (
          SELECT COUNT(*)::int
          FROM information_schema.tables
          WHERE table_schema = 'control_plane'
            AND table_name IN ('projects', 'services', 'operational_configurations')
        ) = 3 AS core_tables_ready,
        (
          SELECT COUNT(*)::int
          FROM public.schema_migrations
        ) AS migrations_applied
    `);
    const latencyMilliseconds = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    const row = result.rows[0];

    if (!row) {
      return {
        status: 'error',
        error: 'PostgreSQL health query returned no rows',
        latencyMilliseconds,
      };
    }

    if (!row.control_plane_schema_ready || !row.core_tables_ready) {
      return {
        status: 'error',
        controlPlaneSchemaReady: row.control_plane_schema_ready,
        coreTablesReady: row.core_tables_ready,
        database: row.database_name,
        error: 'PostgreSQL schema is not ready',
        latencyMilliseconds,
        migrationsApplied: row.migrations_applied,
      };
    }

    return {
      status: 'ok',
      controlPlaneSchemaReady: true,
      coreTablesReady: true,
      database: row.database_name,
      latencyMilliseconds,
      migrationsApplied: row.migrations_applied,
    };
  } catch {
    return {
      status: 'error',
      error: 'PostgreSQL health query failed',
    };
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
