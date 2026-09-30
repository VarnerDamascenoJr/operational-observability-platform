import helmet from '@fastify/helmet';
import sensible from '@fastify/sensible';
import Fastify, { LogController } from 'fastify';

import type { BuildAppOptions } from './app.types.js';
import { loadServiceIdentity } from './config/service.js';
import { correlationIdHeader, requestIdHeader, transactionIdHeader } from './constants/headers.js';
import { registerDemoRoutes } from './demo/demo.controller.js';
import { registerHealthRoutes } from './health/health.controller.js';
import { getCorrelationContext } from './observability/correlation.js';
import { registerIncidentRoutes } from './incidents.js';
import { registerMetricsRoutes } from './observability/metrics.controller.js';
import { HttpMetrics } from './observability/metrics.js';
import { registerSloRoutes } from './slo/slo.controller.js';
import { NoopTelemetryExporter } from './observability/otlp.js';
import { decorateObservabilityRequest } from './observability/correlation.fastify.js';

export function buildApp(options: BuildAppOptions = {}) {
  const identity = options.identity ?? loadServiceIdentity();
  const metrics =
    options.metrics ??
    new HttpMetrics({ service: identity.serviceName, environment: identity.environment });
  const telemetry = options.telemetry ?? new NoopTelemetryExporter();
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
      base: {
        service_name: identity.serviceName,
        environment: identity.environment,
      },
      transport:
        identity.environment === 'development' && !options.loggerStream
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
  decorateObservabilityRequest(app);

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

  registerHealthRoutes(app, options.database);
  registerMetricsRoutes(app, { database: options.database, metrics });
  registerSloRoutes(app, options.database);
  registerIncidentRoutes(app, options.database);
  registerDemoRoutes(app, { metrics, telemetry });

  return app;
}
