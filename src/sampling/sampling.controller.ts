import type { FastifyInstance } from 'fastify';

import type { SqlExecutor } from '../database/postgres.js';
import { ValidationError } from '../errors/validation-error.js';
import { requireRecord, requiredInteger } from '../validation/primitives.js';

interface SamplingPolicyRow {
  revision: number;
  latencyThresholdMs: number;
  healthySamplingPercentage: number;
  updatedAt: Date;
}

const fields = `revision, latency_threshold_ms AS "latencyThresholdMs",
  healthy_sampling_percentage AS "healthySamplingPercentage", updated_at AS "updatedAt"`;

export function registerSamplingRoutes(
  app: FastifyInstance,
  database: SqlExecutor | undefined,
): void {
  app.get('/sampling/policy', async (_request, reply) => {
    if (!database) return reply.code(503).send({ error: 'PostgreSQL is required' });
    const result = await database.query<SamplingPolicyRow>(
      `SELECT ${fields} FROM control_plane.sampling_policy WHERE singleton = true`,
    );
    if (!result.rows[0]) return reply.code(503).send({ error: 'Sampling policy is unavailable' });
    return { policy: result.rows[0], application: 'manual' };
  });

  app.put('/sampling/policy', async (request, reply) => {
    if (!database) return reply.code(503).send({ error: 'PostgreSQL is required' });
    const body = requireRecord(request.body, 'body must be an object');
    if (
      Object.keys(body).some(
        (key) => !['revision', 'latencyThresholdMs', 'healthySamplingPercentage'].includes(key),
      )
    ) {
      throw new ValidationError('body contains an unsupported field');
    }
    const revision = requiredInteger(body.revision, 'revision', {
      minimum: 1,
      maximum: 2147483646,
    });
    const latencyThresholdMs = requiredInteger(body.latencyThresholdMs, 'latencyThresholdMs', {
      minimum: 1,
      maximum: 3600000,
    });
    const healthySamplingPercentage = requiredInteger(
      body.healthySamplingPercentage,
      'healthySamplingPercentage',
      { minimum: 0, maximum: 100 },
    );
    const result = await database.query<SamplingPolicyRow>(
      `UPDATE control_plane.sampling_policy SET
        latency_threshold_ms = $1, healthy_sampling_percentage = $2,
        revision = revision + 1, updated_at = now()
      WHERE singleton = true AND revision = $3
      RETURNING ${fields}`,
      [latencyThresholdMs, healthySamplingPercentage, revision],
    );
    if (!result.rows[0])
      return reply.code(409).send({ error: 'Sampling policy revision conflict' });
    return { policy: result.rows[0], application: 'manual' };
  });
}
