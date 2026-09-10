import helmet from '@fastify/helmet';
import sensible from '@fastify/sensible';
import Fastify, { LogController } from 'fastify';
import type { Writable } from 'node:stream';

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
  loggerStream?: Writable;
  metrics?: HttpMetrics;
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

  app.get('/health', async () => ({ status: 'ok' }));
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
