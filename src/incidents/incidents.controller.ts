import type { FastifyInstance } from 'fastify';

import type { SqlExecutor } from '../database/postgres.js';
import { ValidationError } from '../errors/validation-error.js';
import { IncidentRepository } from './incidents.repository.js';
import { IncidentService } from './incidents.service.js';
import {
  parseCreateIncidentInput,
  parseEvidenceInput,
  parseHypothesisInput,
  parseIncidentId,
  parseTimelineInput,
  parseUpdateIncidentInput,
} from './incidents.validation.js';

export function registerIncidentRoutes(
  app: FastifyInstance,
  database: SqlExecutor | undefined,
): void {
  app.post('/incidents', async (request, reply) => {
    if (!database) {
      void reply.code(503);
      return { error: 'PostgreSQL is required to open incidents' };
    }

    try {
      const input = parseCreateIncidentInput(request.body);
      const service = createIncidentService(database);
      const incident = await service.create(input);
      void reply.code(201);
      return incident;
    } catch (error) {
      if (error instanceof ValidationError) {
        void reply.code(400);
        return { error: error.message };
      }

      throw error;
    }
  });

  app.get('/incidents', async (_request, reply) => {
    if (!database) {
      void reply.code(503);
      return { error: 'PostgreSQL is required to list incidents' };
    }

    const service = createIncidentService(database);
    return { incidents: await service.list() };
  });

  app.get('/incidents/:incidentId', async (request, reply) => {
    if (!database) {
      void reply.code(503);
      return { error: 'PostgreSQL is required to read incidents' };
    }

    try {
      const incidentId = parseIncidentId(request.params);
      const service = createIncidentService(database);
      const incident = await service.findById(incidentId);

      if (!incident) {
        void reply.code(404);
        return { error: 'Incident not found' };
      }

      return incident;
    } catch (error) {
      if (error instanceof ValidationError) {
        void reply.code(400);
        return { error: error.message };
      }

      throw error;
    }
  });

  app.patch('/incidents/:incidentId', async (request, reply) => {
    if (!database) {
      void reply.code(503);
      return { error: 'PostgreSQL is required to update incidents' };
    }

    try {
      const incidentId = parseIncidentId(request.params);
      const input = parseUpdateIncidentInput(request.body);
      const service = createIncidentService(database);
      const incident = await service.update(incidentId, input);

      if (!incident) {
        void reply.code(404);
        return { error: 'Incident not found' };
      }

      return incident;
    } catch (error) {
      if (error instanceof ValidationError) {
        void reply.code(400);
        return { error: error.message };
      }

      throw error;
    }
  });

  app.post('/incidents/:incidentId/evidence', async (request, reply) => {
    if (!database) {
      void reply.code(503);
      return { error: 'PostgreSQL is required to add incident evidence' };
    }

    try {
      const incidentId = parseIncidentId(request.params);
      const input = parseEvidenceInput(request.body);
      const service = createIncidentService(database);
      const incident = await service.addEvidence(incidentId, input);

      if (!incident) {
        void reply.code(404);
        return { error: 'Incident not found' };
      }

      void reply.code(201);
      return incident;
    } catch (error) {
      if (error instanceof ValidationError) {
        void reply.code(400);
        return { error: error.message };
      }

      throw error;
    }
  });

  app.post('/incidents/:incidentId/hypotheses', async (request, reply) => {
    if (!database) {
      void reply.code(503);
      return { error: 'PostgreSQL is required to add incident hypotheses' };
    }

    try {
      const incidentId = parseIncidentId(request.params);
      const input = parseHypothesisInput(request.body);
      const service = createIncidentService(database);
      const incident = await service.addHypothesis(incidentId, input);

      if (!incident) {
        void reply.code(404);
        return { error: 'Incident not found' };
      }

      void reply.code(201);
      return incident;
    } catch (error) {
      if (error instanceof ValidationError) {
        void reply.code(400);
        return { error: error.message };
      }

      throw error;
    }
  });

  app.post('/incidents/:incidentId/timeline', async (request, reply) => {
    if (!database) {
      void reply.code(503);
      return { error: 'PostgreSQL is required to add incident timeline events' };
    }

    try {
      const incidentId = parseIncidentId(request.params);
      const input = parseTimelineInput(request.body);
      const service = createIncidentService(database);
      const incident = await service.addTimelineEvent(incidentId, input);

      if (!incident) {
        void reply.code(404);
        return { error: 'Incident not found' };
      }

      void reply.code(201);
      return incident;
    } catch (error) {
      if (error instanceof ValidationError) {
        void reply.code(400);
        return { error: error.message };
      }

      throw error;
    }
  });
}

function createIncidentService(database: SqlExecutor): IncidentService {
  return new IncidentService(new IncidentRepository(database));
}
