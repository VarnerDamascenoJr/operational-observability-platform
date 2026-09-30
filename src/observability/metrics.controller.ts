import type { FastifyInstance } from 'fastify';

import type { SqlExecutor } from '../database/postgres.js';
import { renderSloPrometheusMetrics } from '../slo/slo.metrics.js';
import type { HttpMetrics } from './metrics.js';

interface MetricsRouteOptions {
  database?: SqlExecutor;
  metrics: HttpMetrics;
}

export function registerMetricsRoutes(app: FastifyInstance, options: MetricsRouteOptions): void {
  app.get('/metrics', async (request, reply) => {
    void reply.type('text/plain; version=0.0.4; charset=utf-8');

    let sloMetrics = '';

    if (options.database) {
      try {
        sloMetrics = await renderSloPrometheusMetrics(options.database);
      } catch (error) {
        request.log.warn(
          {
            error: error instanceof Error ? error.message : 'unknown SLO metrics error',
          },
          'slo metrics rendering failed',
        );
      }
    }

    return `${options.metrics.renderPrometheus()}${sloMetrics}`;
  });

  app.get('/metrics/latency-distribution', async () => ({
    distributions: options.metrics.latencyDistributions(),
  }));
}
