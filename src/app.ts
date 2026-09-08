import helmet from '@fastify/helmet';
import sensible from '@fastify/sensible';
import Fastify, { LogController } from 'fastify';
import type { Writable } from 'node:stream';

import {
  getCorrelationContext,
  requestIdHeader,
  transactionIdHeader,
} from './observability/correlation.js';

declare module 'fastify' {
  interface FastifyRequest {
    transactionId: string;
  }
}

interface BuildAppOptions {
  loggerStream?: Writable;
}

export function buildApp(options: BuildAppOptions = {}) {
  const environment = process.env.NODE_ENV ?? 'development';
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
      base: {
        service_name: 'operational-observability-platform',
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
          transaction_id: context.transactionId,
        },
        childLoggerOptions,
      );
    },
  });

  void app.register(helmet);
  void app.register(sensible);
  app.decorateRequest('transactionId', '');

  app.addHook('onRequest', async (request, reply) => {
    const context = getCorrelationContext(request.raw);
    request.transactionId = context.transactionId;
    void reply.header(requestIdHeader, context.requestId);
    void reply.header(transactionIdHeader, context.transactionId);
  });

  app.get('/health', async () => ({ status: 'ok' }));

  return app;
}
