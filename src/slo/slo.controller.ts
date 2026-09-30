import type { FastifyInstance } from 'fastify';

import type { SqlExecutor } from '../database/postgres.js';
import { ValidationError } from '../errors/validation-error.js';
import { SloRepository } from './slo.repository.js';
import {
  parseBurnRateWindowCounts,
  parseCreateSloInput,
  parseEvaluationInput,
  parseRollingWindowLimit,
  parseSloId,
} from './slo.validation.js';

export function registerSloRoutes(app: FastifyInstance, database: SqlExecutor | undefined): void {
  app.post('/slos', async (request, reply) => {
    if (!database) {
      void reply.code(503);
      return { error: 'PostgreSQL is required to configure SLOs' };
    }

    try {
      const input = parseCreateSloInput(request.body);
      const repository = new SloRepository(database);
      const slo = await repository.upsert(input);
      void reply.code(201);
      return slo;
    } catch (error) {
      if (error instanceof ValidationError) {
        void reply.code(400);
        return { error: error.message };
      }

      throw error;
    }
  });

  app.get('/slos', async (_request, reply) => {
    if (!database) {
      void reply.code(503);
      return { error: 'PostgreSQL is required to list SLOs' };
    }

    const repository = new SloRepository(database);
    return { slos: await repository.list() };
  });

  app.post('/slos/:sloId/evaluations', async (request, reply) => {
    if (!database) {
      void reply.code(503);
      return { error: 'PostgreSQL is required to evaluate SLOs' };
    }

    try {
      const sloId = parseSloId(request.params);
      const input = parseEvaluationInput(request.body);
      const repository = new SloRepository(database);
      const response = await repository.evaluate(sloId, input);

      if (!response) {
        void reply.code(404);
        return { error: 'SLO not found' };
      }

      void reply.code(201);
      return response;
    } catch (error) {
      if (error instanceof ValidationError) {
        void reply.code(400);
        return { error: error.message };
      }

      throw error;
    }
  });

  app.get('/slos/:sloId/status', async (request, reply) => {
    if (!database) {
      void reply.code(503);
      return { error: 'PostgreSQL is required to read SLO status' };
    }

    try {
      const sloId = parseSloId(request.params);
      const repository = new SloRepository(database);
      const response = await repository.latestStatus(sloId);

      if (!response) {
        void reply.code(404);
        return { error: 'SLO not found' };
      }

      return response;
    } catch (error) {
      if (error instanceof ValidationError) {
        void reply.code(400);
        return { error: error.message };
      }

      throw error;
    }
  });

  app.get('/slos/:sloId/rolling-windows', async (request, reply) => {
    if (!database) {
      void reply.code(503);
      return { error: 'PostgreSQL is required to read SLO rolling windows' };
    }

    try {
      const sloId = parseSloId(request.params);
      const limit = parseRollingWindowLimit(request.query);
      const repository = new SloRepository(database);
      const response = await repository.rollingWindows(sloId, limit);

      if (!response) {
        void reply.code(404);
        return { error: 'SLO not found' };
      }

      return response;
    } catch (error) {
      if (error instanceof ValidationError) {
        void reply.code(400);
        return { error: error.message };
      }

      throw error;
    }
  });

  app.get('/slos/:sloId/burn-rate', async (request, reply) => {
    if (!database) {
      void reply.code(503);
      return { error: 'PostgreSQL is required to read SLO burn rate' };
    }

    try {
      const sloId = parseSloId(request.params);
      const input = parseBurnRateWindowCounts(request.query);
      const repository = new SloRepository(database);
      const response = await repository.burnRate(sloId, input);

      if (!response) {
        void reply.code(404);
        return { error: 'SLO not found' };
      }

      return response;
    } catch (error) {
      if (error instanceof ValidationError) {
        void reply.code(400);
        return { error: error.message };
      }

      throw error;
    }
  });
}
