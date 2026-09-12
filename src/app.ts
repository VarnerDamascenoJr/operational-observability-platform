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
} from './observability/correlation.js';
import { HttpMetrics } from './observability/metrics.js';

declare module 'fastify' {
  interface FastifyRequest {
    correlationId: string;
    observedRoute: string;
    startedAtNanoseconds: bigint;
    transactionId: string;
  }
}

interface BuildAppOptions {
  closeDatabase?: () => Promise<void>;
  database?: SqlExecutor;
  loggerStream?: Writable;
  metrics?: HttpMetrics;
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
  app.get('/metrics', async (_request, reply) => {
    void reply.type('text/plain; version=0.0.4; charset=utf-8');
    return metrics.renderPrometheus();
  });
  app.get('/demo/transactions', async (request, reply) => {
    const query = request.query as { delayMs?: string; outcome?: string };
    const delayMilliseconds = boundedDelay(query.delayMs);
    await sleep(delayMilliseconds);

    if (query.outcome === 'error') {
      request.log.warn(
        {
          operation: 'demo_transaction',
          outcome: 'error',
          simulated_delay_ms: delayMilliseconds,
        },
        'demo transaction failed',
      );
      void reply.code(503);
      return {
        status: 'failed',
        transactionId: request.transactionId,
        correlationId: request.correlationId,
        simulatedDelayMs: delayMilliseconds,
      };
    }

    request.log.info(
      {
        operation: 'demo_transaction',
        outcome: 'success',
        simulated_delay_ms: delayMilliseconds,
      },
      'demo transaction completed',
    );
    return {
      status: 'succeeded',
      transactionId: request.transactionId,
      correlationId: request.correlationId,
      simulatedDelayMs: delayMilliseconds,
    };
  });

  return app;
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

function boundedDelay(value: string | undefined): number {
  if (!value) {
    return 0;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0;
  }
  return Math.min(parsed, 2_000);
}

function sleep(milliseconds: number): Promise<void> {
  if (milliseconds <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}
