import type { Writable } from 'node:stream';

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
