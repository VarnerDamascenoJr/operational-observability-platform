import helmet from '@fastify/helmet';
import sensible from '@fastify/sensible';
import Fastify, { LogController } from 'fastify';

import type { BuildAppOptions } from './app.types.js';
import { loadServiceIdentity } from './config/service.js';
import { registerDemoRoutes } from './demo/demo.controller.js';
import { registerHealthRoutes } from './health/health.controller.js';
import { getCorrelationContext } from './observability/correlation.js';
import { registerIncidentRoutes } from './incidents/incidents.controller.js';
import { registerMetricsRoutes } from './observability/metrics.controller.js';
import { HttpMetrics } from './observability/metrics.js';
import { registerObservabilityHooks } from './observability/observability.hooks.js';
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
  registerObservabilityHooks(app, metrics);

  if (options.closeDatabase) {
    app.addHook('onClose', async () => {
      await options.closeDatabase?.();
    });
  }

  registerHealthRoutes(app, options.database);
  registerMetricsRoutes(app, { database: options.database, metrics });
  registerSloRoutes(app, options.database);
  registerIncidentRoutes(app, options.database);
  registerDemoRoutes(app, { metrics, telemetry });

  return app;
}
