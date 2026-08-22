import helmet from '@fastify/helmet';
import sensible from '@fastify/sensible';
import Fastify from 'fastify';

export function buildApp() {
  const app = Fastify({
    logger: {
      transport: process.env.NODE_ENV === 'development' ? { target: 'pino-pretty' } : undefined,
    },
  });

  void app.register(helmet);
  void app.register(sensible);

  app.get('/health', async () => ({ status: 'ok' }));

  return app;
}
