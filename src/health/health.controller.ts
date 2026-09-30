import type { FastifyInstance } from 'fastify';

import type { SqlExecutor } from '../database/postgres.js';
import { checkPostgres } from './health.service.js';
import type { HealthResponse } from './health.types.js';

export function registerHealthRoutes(
  app: FastifyInstance,
  database: SqlExecutor | undefined,
): void {
  app.get('/health', async (_request, reply) => {
    const postgres = await checkPostgres(database);
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
}
