import type { Writable } from 'node:stream';

import type { QueryResultRow } from 'pg';

import type { ServiceIdentity } from './config/service.js';
import type { SqlExecutor } from './database/postgres.js';
import type { HttpMetrics } from './observability/metrics.js';
import type { TelemetryExporter } from './observability/otlp.js';

declare module 'fastify' {
  interface FastifyRequest {
    correlationId: string;
    observedRoute: string;
    startedAtNanoseconds: bigint;
    traceId?: string;
    transactionId: string;
  }
}

export interface BuildAppOptions {
  closeDatabase?: () => Promise<void>;
  database?: SqlExecutor;
  identity?: ServiceIdentity;
  loggerStream?: Writable;
  metrics?: HttpMetrics;
  telemetry?: TelemetryExporter;
}

export interface PostgresHealthRow extends QueryResultRow {
  control_plane_schema_ready: boolean;
  core_tables_ready: boolean;
  database_name: string;
  migrations_applied: number;
}

export type PostgresHealth =
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

export interface HealthResponse {
  services: {
    api: {
      status: 'ok';
    };
    postgres: PostgresHealth;
  };
  status: 'degraded' | 'ok';
}
