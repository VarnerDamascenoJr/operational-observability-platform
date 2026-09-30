import type { FastifyInstance } from 'fastify';

import { correlationIdHeader, requestIdHeader, transactionIdHeader } from '../constants/headers.js';
import { getCorrelationContext } from './correlation.js';
import type { HttpMetrics } from './metrics.js';

export function registerObservabilityHooks(app: FastifyInstance, metrics: HttpMetrics): void {
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
}
