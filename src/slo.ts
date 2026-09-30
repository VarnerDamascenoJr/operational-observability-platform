import type { FastifyInstance } from 'fastify';

import type { SqlExecutor } from './database/postgres.js';
import { ValidationError } from './errors/validation-error.js';
import type {
  CreateEvaluationInput,
  CreateSloInput,
  EvaluationSource,
  RollingSliWindow,
  SliEventCounts,
  SliObjectiveInput,
  SliType,
  SloBurnRateMetricRow,
  SloMetricRow,
} from './slo.types.js';
import {
  latestSloBurnRateRowsSql,
  latestSloMetricRowsSql,
  sloPrometheusMetricDefinitions,
} from './slo.prometheus.js';
import {
  calculateObjectiveBurnRate,
  calculateSliEvaluation,
  round,
} from './slo/slo.calculations.js';
import { SloRepository } from './slo/slo.repository.js';
import { renderPrometheusMetricDefinitions } from './utils/prometheus.js';
import { slugPattern, uuidPattern } from './validation/patterns.js';

export {
  calculateBurnRateWindow,
  calculateObjectiveBurnRate,
  calculateSliEvaluation,
  classifyMultiWindowBurnRate,
  overallBurnRateSeverity,
  overallSloStatus,
  summarizeRollingWindows,
} from './slo/slo.calculations.js';

export async function renderSloPrometheusMetrics(database: SqlExecutor): Promise<string> {
  const result = await database.query<SloMetricRow>(latestSloMetricRowsSql);

  const lines = renderPrometheusMetricDefinitions(sloPrometheusMetricDefinitions);

  for (const row of result.rows) {
    const labels = metricLabels({
      service: row.service_slug,
      environment: row.environment,
      slo: row.slo_slug,
      sli_type: row.indicator_type,
      status: row.status ?? 'no_data',
    });

    if (row.observed_percentage !== null) {
      lines.push(`slo_observed_percentage{${labels}} ${Number(row.observed_percentage)}`);
    }

    if (row.error_budget_consumed_percentage !== null) {
      lines.push(
        `slo_error_budget_consumed_percentage{${labels}} ${Number(
          row.error_budget_consumed_percentage,
        )}`,
      );
    }

    if (row.error_budget_remaining_percentage !== null) {
      lines.push(
        `slo_error_budget_remaining_percentage{${labels}} ${Number(
          row.error_budget_remaining_percentage,
        )}`,
      );
    }
  }

  lines.push(...(await renderSloBurnRateMetricLines(database)));

  return `${lines.join('\n')}\n`;
}

async function renderSloBurnRateMetricLines(database: SqlExecutor): Promise<string[]> {
  const result = await database.query<SloBurnRateMetricRow>(latestSloBurnRateRowsSql);
  const rowsByObjective = new Map<string, SloBurnRateMetricRow[]>();

  for (const row of result.rows) {
    const key = [
      row.service_slug,
      row.environment,
      row.slo_slug,
      row.indicator_type,
      row.target_percentage,
    ].join('\0');
    const rows = rowsByObjective.get(key) ?? [];
    rows.push(row);
    rowsByObjective.set(key, rows);
  }

  return Array.from(rowsByObjective.values()).flatMap((rows) => {
    const first = rows[0];

    if (!first) {
      return [];
    }

    const windows = rows.flatMap((row): RollingSliWindow[] => {
      if (
        !row.window_started_at ||
        !row.window_ended_at ||
        row.total_events === null ||
        row.good_events === null
      ) {
        return [];
      }

      const totalEvents = Number(row.total_events);
      const goodEvents = Number(row.good_events);

      return [
        {
          ...calculateSliEvaluation(
            { targetPercentage: Number(row.target_percentage) },
            { goodEvents, totalEvents },
          ),
          endedAt: row.window_ended_at.toISOString(),
          source: { kind: 'manual' },
          startedAt: row.window_started_at.toISOString(),
        },
      ];
    });

    const burnRate = calculateObjectiveBurnRate(
      {
        ...(first.latency_threshold_ms
          ? { latencyThresholdMilliseconds: first.latency_threshold_ms }
          : {}),
        targetPercentage: Number(first.target_percentage),
        type: first.indicator_type,
      },
      windows,
      {
        longWindowCount: 6,
        shortWindowCount: 1,
        windowDays: first.window_days,
      },
    );

    const baseLabels = {
      service: first.service_slug,
      environment: first.environment,
      slo: first.slo_slug,
      sli_type: first.indicator_type,
      severity: burnRate.severity,
    };

    return [
      burnRate.shortWindow.burnRate === null
        ? undefined
        : `slo_error_budget_burn_rate{${metricLabels({
            ...baseLabels,
            window: 'short',
          })}} ${burnRate.shortWindow.burnRate}`,
      burnRate.longWindow.burnRate === null
        ? undefined
        : `slo_error_budget_burn_rate{${metricLabels({
            ...baseLabels,
            window: 'long',
          })}} ${burnRate.longWindow.burnRate}`,
    ].flatMap((line) => (line ? [line] : []));
  });
}

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

function parseCreateSloInput(value: unknown): CreateSloInput {
  const body = requireRecord(value, 'Request body must be an object');
  const project = requireRecord(body.project, 'project must be an object');
  const service = requireRecord(body.service, 'service must be an object');
  const objectives = requireArray(body.objectives, 'objectives must be an array').map(
    parseObjective,
  );
  const objectiveTypes = new Set(objectives.map((objective) => objective.type));

  if (objectives.length === 0) {
    throw new ValidationError('At least one SLI objective is required');
  }

  if (objectiveTypes.size !== objectives.length) {
    throw new ValidationError('Each SLI objective type can appear only once');
  }

  return {
    description: optionalString(body.description, 'description'),
    name: requiredString(body.name, 'name'),
    objectives,
    project: {
      description: optionalString(project.description, 'project.description'),
      name: requiredString(project.name, 'project.name'),
      slug: requiredSlug(project.slug, 'project.slug'),
    },
    service: {
      environment: requiredString(service.environment, 'service.environment'),
      name: requiredString(service.name, 'service.name'),
      owner: optionalString(service.owner, 'service.owner'),
      slug: requiredSlug(service.slug, 'service.slug'),
    },
    slug: requiredSlug(body.slug, 'slug'),
    windowDays: requiredInteger(body.windowDays, 'windowDays', { maximum: 90, minimum: 1 }),
  };
}

function parseEvaluationInput(value: unknown): CreateEvaluationInput {
  const body = requireRecord(value, 'Request body must be an object');
  const indicators = requireRecord(body.indicators, 'indicators must be an object');
  const windowStartedAt = requiredIsoDate(body.windowStartedAt, 'windowStartedAt');
  const windowEndedAt = requiredIsoDate(body.windowEndedAt, 'windowEndedAt');

  if (Date.parse(windowEndedAt) <= Date.parse(windowStartedAt)) {
    throw new ValidationError('windowEndedAt must be after windowStartedAt');
  }

  return {
    indicators: {
      availability: parseOptionalCounts(indicators.availability, 'indicators.availability'),
      latency: parseOptionalCounts(indicators.latency, 'indicators.latency'),
    },
    source: parseEvaluationSource(body.source),
    windowEndedAt,
    windowStartedAt,
  };
}

function parseEvaluationSource(value: unknown): EvaluationSource {
  if (value === undefined) {
    return { kind: 'manual' };
  }

  const source = requireRecord(value, 'source must be an object');
  const kind = requiredString(source.kind, 'source.kind');

  if (kind !== 'manual' && kind !== 'fixture' && kind !== 'prometheus') {
    throw new ValidationError('source.kind must be manual, fixture or prometheus');
  }

  return {
    kind,
    period: optionalString(source.period, 'source.period'),
    query: optionalString(source.query, 'source.query'),
  };
}

function parseOptionalCounts(value: unknown, field: string): SliEventCounts | undefined {
  if (value === undefined) {
    return undefined;
  }

  const counts = requireRecord(value, `${field} must be an object`);
  const totalEvents = requiredInteger(counts.totalEvents, `${field}.totalEvents`, {
    maximum: Number.MAX_SAFE_INTEGER,
    minimum: 0,
  });
  const goodEvents = requiredInteger(counts.goodEvents, `${field}.goodEvents`, {
    maximum: totalEvents,
    minimum: 0,
  });

  return { goodEvents, totalEvents };
}

function parseObjective(value: unknown): SliObjectiveInput {
  const objective = requireRecord(value, 'objective must be an object');
  const type = objective.type;

  if (type !== 'availability' && type !== 'latency') {
    throw new ValidationError('objective.type must be availability or latency');
  }

  return {
    ...(type === 'latency'
      ? {
          latencyThresholdMilliseconds: requiredInteger(
            objective.latencyThresholdMilliseconds,
            'objective.latencyThresholdMilliseconds',
            { maximum: 60_000, minimum: 1 },
          ),
        }
      : {}),
    targetPercentage: requiredPercentage(objective.targetPercentage, 'objective.targetPercentage'),
    type,
  };
}

function parseSloId(value: unknown): string {
  const params = requireRecord(value, 'Route params must be an object');
  const sloId = requiredString(params.sloId, 'sloId');

  if (!uuidPattern.test(sloId)) {
    throw new ValidationError('sloId must be a UUID');
  }

  return sloId;
}

function parseRollingWindowLimit(value: unknown): number {
  const query = requireRecord(value, 'Query params must be an object');
  const rawLimit = query.limit;

  if (rawLimit === undefined) {
    return 14;
  }

  const limit =
    typeof rawLimit === 'string' && rawLimit.trim() !== '' ? Number(rawLimit) : rawLimit;

  return requiredInteger(limit, 'limit', { maximum: 90, minimum: 1 });
}

function parseBurnRateWindowCounts(value: unknown): {
  longWindowCount: number;
  shortWindowCount: number;
} {
  const query = requireRecord(value, 'Query params must be an object');
  const shortWindowCount = optionalInteger(query.shortWindows, 'shortWindows', {
    defaultValue: 1,
    maximum: 30,
    minimum: 1,
  });
  const longWindowCount = optionalInteger(query.longWindows, 'longWindows', {
    defaultValue: 6,
    maximum: 90,
    minimum: 1,
  });

  if (longWindowCount < shortWindowCount) {
    throw new ValidationError('longWindows must be greater than or equal to shortWindows');
  }

  return { longWindowCount, shortWindowCount };
}

function metricLabels(labels: Record<string, string>): string {
  return Object.entries(labels)
    .map(([key, value]) => `${key}="${escapeMetricLabel(value)}"`)
    .join(',');
}

function escapeMetricLabel(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('\n', '\\n').replaceAll('"', '\\"');
}

function requireRecord(value: unknown, message: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ValidationError(message);
  }

  return value as Record<string, unknown>;
}

function requireArray(value: unknown, message: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new ValidationError(message);
  }

  return value;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ValidationError(`${field} must be a non-empty string`);
  }

  return value.trim();
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  return requiredString(value, field);
}

function requiredSlug(value: unknown, field: string): string {
  const slug = requiredString(value, field);

  if (!slugPattern.test(slug)) {
    throw new ValidationError(`${field} must be a safe slug`);
  }

  return slug;
}

function requiredPercentage(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value >= 100) {
    throw new ValidationError(`${field} must be greater than 0 and lower than 100`);
  }

  return round(value, 3);
}

function requiredInteger(
  value: unknown,
  field: string,
  range: { maximum: number; minimum: number },
): number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < range.minimum ||
    value > range.maximum
  ) {
    throw new ValidationError(
      `${field} must be an integer between ${range.minimum} and ${range.maximum}`,
    );
  }

  return value;
}

function optionalInteger(
  value: unknown,
  field: string,
  range: { defaultValue: number; maximum: number; minimum: number },
): number {
  if (value === undefined) {
    return range.defaultValue;
  }

  const parsed = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return requiredInteger(parsed, field, range);
}

function requiredIsoDate(value: unknown, field: string): string {
  const text = requiredString(value, field);
  const time = Date.parse(text);

  if (!Number.isFinite(time)) {
    throw new ValidationError(`${field} must be a valid ISO date`);
  }

  return new Date(time).toISOString();
}
