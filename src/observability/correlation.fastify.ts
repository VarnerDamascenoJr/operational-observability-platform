import type { FastifyInstance } from 'fastify';

export function decorateObservabilityRequest(app: FastifyInstance): void {
  app.decorateRequest('correlationId', '');
  app.decorateRequest('observedRoute', '');
  app.decorateRequest('startedAtNanoseconds', 0n);
  app.decorateRequest('traceId');
  app.decorateRequest('transactionId', '');
}
