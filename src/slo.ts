import type { FastifyInstance } from 'fastify';
import type { QueryResultRow } from 'pg';

import type { SqlExecutor } from './database/postgres.js';

export type SliType = 'availability' | 'latency';
export type SliStatus = 'breached' | 'no_data' | 'ok';

const slugPattern = /^[a-z0-9][a-z0-9_-]{1,62}[a-z0-9]$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface SliObjectiveInput {
  latencyThresholdMilliseconds?: number;
  targetPercentage: number;
  type: SliType;
}

export interface CreateSloInput {
  description?: string;
  name: string;
  objectives: SliObjectiveInput[];
  project: {
    description?: string;
    name: string;
    slug: string;
  };
  service: {
    environment: string;
    name: string;
    owner?: string;
    slug: string;
  };
  slug: string;
  windowDays: number;
}

export interface SliObjective {
  id: string;
  latencyThresholdMilliseconds?: number;
  targetPercentage: number;
  type: SliType;
}

export interface SloDefinition {
  createdAt: string;
  description?: string;
  id: string;
  name: string;
  objectives: SliObjective[];
  project: {
    id: string;
    name: string;
    slug: string;
  };
  service: {
    environment: string;
    id: string;
    name: string;
    owner?: string;
    slug: string;
  };
  slug: string;
  windowDays: number;
}

export interface SliEventCounts {
  goodEvents: number;
  totalEvents: number;
}

export interface SliEvaluationResult {
  badEvents: number;
  errorBudgetConsumedPercentage: number | null;
  errorBudgetRemainingPercentage: number | null;
  errorBudgetTotalEvents: number | null;
  goodEvents: number;
  observedPercentage: number | null;
  status: SliStatus;
  targetPercentage: number;
  totalEvents: number;
}

export interface EvaluationObjectiveResult extends SliEvaluationResult {
  latencyThresholdMilliseconds?: number;
  type: SliType;
}

export interface SloEvaluationResponse {
  objectives: EvaluationObjectiveResult[];
  overallStatus: SliStatus;
  slo: SloDefinition;
  window: {
    endedAt: string;
    startedAt: string;
  };
}

interface CreateEvaluationInput {
  indicators: Partial<Record<SliType, SliEventCounts>>;
  windowEndedAt: string;
  windowStartedAt: string;
}

interface ProjectRow extends QueryResultRow {
  id: string;
  name: string;
  slug: string;
}

interface ServiceRow extends QueryResultRow {
  environment: string;
  id: string;
  name: string;
  owner: string | null;
  slug: string;
}

interface SloRow extends QueryResultRow {
  created_at: Date;
  description: string | null;
  id: string;
  name: string;
  project_id: string;
  project_name: string;
  project_slug: string;
  service_environment: string;
  service_id: string;
  service_name: string;
  service_owner: string | null;
  service_slug: string;
  slug: string;
  window_days: number;
  objectives: unknown;
}

interface LatestEvaluationRow extends QueryResultRow {
  error_budget_consumed_percentage: string | null;
  error_budget_remaining_percentage: string | null;
  error_budget_total_events: string | null;
  good_events: string;
  indicator_type: SliType;
  latency_threshold_ms: number | null;
  observed_percentage: string | null;
  status: SliStatus;
  target_percentage_snapshot: string;
  total_events: string;
  window_ended_at: Date;
  window_started_at: Date;
}

interface SloMetricRow extends QueryResultRow {
  environment: string;
  error_budget_consumed_percentage: string | null;
  error_budget_remaining_percentage: string | null;
  indicator_type: SliType;
  observed_percentage: string | null;
  service_slug: string;
  slo_slug: string;
  status: SliStatus | null;
  window_ended_at: Date | null;
}

class ValidationError extends Error {}

export function calculateSliEvaluation(
  objective: Pick<SliObjective, 'targetPercentage'>,
  counts: SliEventCounts,
): SliEvaluationResult {
  const badEvents = counts.totalEvents - counts.goodEvents;

  if (counts.totalEvents === 0) {
    return {
      badEvents,
      errorBudgetConsumedPercentage: null,
      errorBudgetRemainingPercentage: null,
      errorBudgetTotalEvents: null,
      goodEvents: counts.goodEvents,
      observedPercentage: null,
      status: 'no_data',
      targetPercentage: objective.targetPercentage,
      totalEvents: counts.totalEvents,
    };
  }

  const observedPercentage = round((counts.goodEvents / counts.totalEvents) * 100, 5);
  const errorBudgetTotalEvents = round(
    counts.totalEvents * (1 - objective.targetPercentage / 100),
    3,
  );
  const errorBudgetConsumedPercentage = round((badEvents / errorBudgetTotalEvents) * 100, 3);
  const errorBudgetRemainingPercentage = round(100 - errorBudgetConsumedPercentage, 3);

  return {
    badEvents,
    errorBudgetConsumedPercentage,
    errorBudgetRemainingPercentage,
    errorBudgetTotalEvents,
    goodEvents: counts.goodEvents,
    observedPercentage,
    status: observedPercentage >= objective.targetPercentage ? 'ok' : 'breached',
    targetPercentage: objective.targetPercentage,
    totalEvents: counts.totalEvents,
  };
}

export function overallSloStatus(
  results: readonly Pick<SliEvaluationResult, 'status'>[],
): SliStatus {
  if (results.some((result) => result.status === 'breached')) {
    return 'breached';
  }

  if (results.length === 0 || results.some((result) => result.status === 'no_data')) {
    return 'no_data';
  }

  return 'ok';
}

export async function renderSloPrometheusMetrics(database: SqlExecutor): Promise<string> {
  const result = await database.query<SloMetricRow>(`
    SELECT
      slo.slug AS slo_slug,
      svc.slug AS service_slug,
      svc.environment,
      sli.indicator_type,
      latest.observed_percentage,
      latest.error_budget_consumed_percentage,
      latest.error_budget_remaining_percentage,
      latest.status,
      latest.window_ended_at
    FROM control_plane.sli_definitions sli
    JOIN control_plane.slo_definitions slo ON slo.id = sli.slo_id
    JOIN control_plane.services svc ON svc.id = slo.service_id
    LEFT JOIN LATERAL (
      SELECT
        observed_percentage,
        error_budget_consumed_percentage,
        error_budget_remaining_percentage,
        status,
        window_ended_at
      FROM control_plane.sli_evaluation_windows evaluation_window
      WHERE evaluation_window.sli_id = sli.id
      ORDER BY evaluation_window.window_ended_at DESC
      LIMIT 1
    ) latest ON true
    WHERE latest.window_ended_at IS NOT NULL
    ORDER BY svc.slug, slo.slug, sli.indicator_type
  `);
  const lines = [
    '# HELP slo_observed_percentage Latest observed SLI percentage by service, SLO and indicator.',
    '# TYPE slo_observed_percentage gauge',
    '# HELP slo_error_budget_consumed_percentage Latest consumed error budget percentage by service, SLO and indicator.',
    '# TYPE slo_error_budget_consumed_percentage gauge',
    '# HELP slo_error_budget_remaining_percentage Latest remaining error budget percentage by service, SLO and indicator.',
    '# TYPE slo_error_budget_remaining_percentage gauge',
  ];

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

  return `${lines.join('\n')}\n`;
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
}

class SloRepository {
  constructor(private readonly database: SqlExecutor) {}

  async upsert(input: CreateSloInput): Promise<SloDefinition> {
    const project = await this.upsertProject(input.project);
    const service = await this.upsertService(project.id, input.service);
    const slo = await this.database.query<{ id: string }>(
      `INSERT INTO control_plane.slo_definitions (
         project_id, service_id, slug, name, description, window_days
       ) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (service_id, slug) DO UPDATE SET
         name = EXCLUDED.name,
         description = EXCLUDED.description,
         window_days = EXCLUDED.window_days,
         updated_at = now()
       RETURNING id`,
      [project.id, service.id, input.slug, input.name, input.description ?? null, input.windowDays],
    );
    const sloId = requireSingleRow(slo.rows, 'SLO was not persisted').id;

    for (const objective of input.objectives) {
      await this.database.query(
        `INSERT INTO control_plane.sli_definitions (
           slo_id, service_id, indicator_type, target_percentage, latency_threshold_ms
         ) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (slo_id, indicator_type) DO UPDATE SET
           target_percentage = EXCLUDED.target_percentage,
           latency_threshold_ms = EXCLUDED.latency_threshold_ms,
           updated_at = now()`,
        [
          sloId,
          service.id,
          objective.type,
          objective.targetPercentage,
          objective.latencyThresholdMilliseconds ?? null,
        ],
      );
    }

    const persisted = await this.findById(sloId);

    if (!persisted) {
      throw new Error('SLO was created but could not be loaded');
    }

    return persisted;
  }

  async list(): Promise<SloDefinition[]> {
    const result = await this.database.query<SloRow>(selectSloDefinitionsSql(''));
    return result.rows.map(mapSloDefinition);
  }

  async evaluate(
    sloId: string,
    input: CreateEvaluationInput,
  ): Promise<SloEvaluationResponse | undefined> {
    const slo = await this.findById(sloId);

    if (!slo) {
      return undefined;
    }

    const objectives: EvaluationObjectiveResult[] = [];

    for (const objective of slo.objectives) {
      const counts = input.indicators[objective.type];

      if (!counts) {
        throw new ValidationError(`Missing event counts for ${objective.type}`);
      }

      const result = calculateSliEvaluation(objective, counts);
      await this.persistEvaluationWindow(slo.id, objective, input, result);
      objectives.push({
        ...result,
        ...(objective.latencyThresholdMilliseconds
          ? { latencyThresholdMilliseconds: objective.latencyThresholdMilliseconds }
          : {}),
        type: objective.type,
      });
    }

    return {
      objectives,
      overallStatus: overallSloStatus(objectives),
      slo,
      window: {
        endedAt: input.windowEndedAt,
        startedAt: input.windowStartedAt,
      },
    };
  }

  async latestStatus(sloId: string): Promise<SloEvaluationResponse | undefined> {
    const slo = await this.findById(sloId);

    if (!slo) {
      return undefined;
    }

    const result = await this.database.query<LatestEvaluationRow>(
      `SELECT DISTINCT ON (sli.id)
         sli.indicator_type,
         sli.latency_threshold_ms,
         ew.window_started_at,
         ew.window_ended_at,
         ew.total_events,
         ew.good_events,
         ew.target_percentage_snapshot,
         ew.observed_percentage,
         ew.error_budget_total_events,
         ew.error_budget_consumed_percentage,
         ew.error_budget_remaining_percentage,
         ew.status
       FROM control_plane.sli_definitions sli
       LEFT JOIN control_plane.sli_evaluation_windows ew ON ew.sli_id = sli.id
       WHERE sli.slo_id = $1
       ORDER BY sli.id, ew.window_ended_at DESC NULLS LAST`,
      [sloId],
    );

    const objectives = result.rows.map((row) => {
      if (!row.window_started_at || !row.window_ended_at) {
        const objective = slo.objectives.find((candidate) => candidate.type === row.indicator_type);

        return {
          badEvents: 0,
          errorBudgetConsumedPercentage: null,
          errorBudgetRemainingPercentage: null,
          errorBudgetTotalEvents: null,
          goodEvents: 0,
          ...(row.latency_threshold_ms
            ? { latencyThresholdMilliseconds: row.latency_threshold_ms }
            : {}),
          observedPercentage: null,
          status: 'no_data' as const,
          targetPercentage:
            objective?.targetPercentage ?? Number(row.target_percentage_snapshot ?? 0),
          totalEvents: 0,
          type: row.indicator_type,
        };
      }

      const totalEvents = Number(row.total_events);
      const goodEvents = Number(row.good_events);

      return {
        badEvents: totalEvents - goodEvents,
        errorBudgetConsumedPercentage: nullableNumber(row.error_budget_consumed_percentage),
        errorBudgetRemainingPercentage: nullableNumber(row.error_budget_remaining_percentage),
        errorBudgetTotalEvents: nullableNumber(row.error_budget_total_events),
        goodEvents,
        ...(row.latency_threshold_ms
          ? { latencyThresholdMilliseconds: row.latency_threshold_ms }
          : {}),
        observedPercentage: nullableNumber(row.observed_percentage),
        status: row.status,
        targetPercentage: Number(row.target_percentage_snapshot),
        totalEvents,
        type: row.indicator_type,
      };
    });

    const latestWindow = result.rows.find((row) => row.window_started_at && row.window_ended_at);

    return {
      objectives,
      overallStatus: overallSloStatus(objectives),
      slo,
      window: latestWindow
        ? {
            endedAt: latestWindow.window_ended_at.toISOString(),
            startedAt: latestWindow.window_started_at.toISOString(),
          }
        : {
            endedAt: '',
            startedAt: '',
          },
    };
  }

  private async findById(id: string): Promise<SloDefinition | undefined> {
    const result = await this.database.query<SloRow>(selectSloDefinitionsSql('WHERE slo.id = $1'), [
      id,
    ]);
    const row = result.rows[0];
    return row ? mapSloDefinition(row) : undefined;
  }

  private async persistEvaluationWindow(
    sloId: string,
    objective: SliObjective,
    input: CreateEvaluationInput,
    result: SliEvaluationResult,
  ): Promise<void> {
    await this.database.query(
      `INSERT INTO control_plane.sli_evaluation_windows (
         slo_id,
         sli_id,
         window_started_at,
         window_ended_at,
         total_events,
         good_events,
         target_percentage_snapshot,
         observed_percentage,
         error_budget_total_events,
         error_budget_consumed_percentage,
         error_budget_remaining_percentage,
         status
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (sli_id, window_started_at, window_ended_at) DO UPDATE SET
         total_events = EXCLUDED.total_events,
         good_events = EXCLUDED.good_events,
         target_percentage_snapshot = EXCLUDED.target_percentage_snapshot,
         observed_percentage = EXCLUDED.observed_percentage,
         error_budget_total_events = EXCLUDED.error_budget_total_events,
         error_budget_consumed_percentage = EXCLUDED.error_budget_consumed_percentage,
         error_budget_remaining_percentage = EXCLUDED.error_budget_remaining_percentage,
         status = EXCLUDED.status,
         updated_at = now()`,
      [
        sloId,
        objective.id,
        input.windowStartedAt,
        input.windowEndedAt,
        result.totalEvents,
        result.goodEvents,
        result.targetPercentage,
        result.observedPercentage,
        result.errorBudgetTotalEvents,
        result.errorBudgetConsumedPercentage,
        result.errorBudgetRemainingPercentage,
        result.status,
      ],
    );
  }

  private async upsertProject(input: CreateSloInput['project']): Promise<ProjectRow> {
    const result = await this.database.query<ProjectRow>(
      `INSERT INTO control_plane.projects (slug, name, description)
       VALUES ($1, $2, $3)
       ON CONFLICT (slug) DO UPDATE SET
         name = EXCLUDED.name,
         description = EXCLUDED.description,
         updated_at = now()
       RETURNING id, slug, name`,
      [input.slug, input.name, input.description ?? null],
    );

    return requireSingleRow(result.rows, 'Project was not persisted');
  }

  private async upsertService(
    projectId: string,
    input: CreateSloInput['service'],
  ): Promise<ServiceRow> {
    const result = await this.database.query<ServiceRow>(
      `INSERT INTO control_plane.services (project_id, slug, name, owner, environment)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (project_id, slug) DO UPDATE SET
         name = EXCLUDED.name,
         owner = EXCLUDED.owner,
         environment = EXCLUDED.environment,
         updated_at = now()
       RETURNING id, slug, name, owner, environment`,
      [projectId, input.slug, input.name, input.owner ?? null, input.environment],
    );

    return requireSingleRow(result.rows, 'Service was not persisted');
  }
}

function selectSloDefinitionsSql(whereClause: string): string {
  return `SELECT
      slo.id,
      slo.slug,
      slo.name,
      slo.description,
      slo.window_days,
      slo.created_at,
      p.id AS project_id,
      p.slug AS project_slug,
      p.name AS project_name,
      svc.id AS service_id,
      svc.slug AS service_slug,
      svc.name AS service_name,
      svc.owner AS service_owner,
      svc.environment AS service_environment,
      COALESCE(
        json_agg(
          json_build_object(
            'id', sli.id,
            'type', sli.indicator_type,
            'targetPercentage', sli.target_percentage::float8,
            'latencyThresholdMilliseconds', sli.latency_threshold_ms
          ) ORDER BY sli.indicator_type
        ) FILTER (WHERE sli.id IS NOT NULL),
        '[]'::json
      ) AS objectives
    FROM control_plane.slo_definitions slo
    JOIN control_plane.projects p ON p.id = slo.project_id
    JOIN control_plane.services svc ON svc.id = slo.service_id
    LEFT JOIN control_plane.sli_definitions sli ON sli.slo_id = slo.id
    ${whereClause}
    GROUP BY slo.id, p.id, svc.id
    ORDER BY slo.created_at, slo.slug`;
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
    windowEndedAt,
    windowStartedAt,
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

function mapSloDefinition(row: SloRow): SloDefinition {
  return {
    ...(row.description ? { description: row.description } : {}),
    createdAt: row.created_at.toISOString(),
    id: row.id,
    name: row.name,
    objectives: parseObjectiveRows(row.objectives),
    project: {
      id: row.project_id,
      name: row.project_name,
      slug: row.project_slug,
    },
    service: {
      environment: row.service_environment,
      id: row.service_id,
      name: row.service_name,
      ...(row.service_owner ? { owner: row.service_owner } : {}),
      slug: row.service_slug,
    },
    slug: row.slug,
    windowDays: row.window_days,
  };
}

function parseObjectiveRows(value: unknown): SliObjective[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry): SliObjective[] => {
    const row = requireRecord(entry, 'objective row must be an object');
    const type = row.type;

    if (type !== 'availability' && type !== 'latency') {
      return [];
    }

    return [
      {
        id: requiredString(row.id, 'objective.id'),
        ...(typeof row.latencyThresholdMilliseconds === 'number'
          ? { latencyThresholdMilliseconds: row.latencyThresholdMilliseconds }
          : {}),
        targetPercentage: Number(row.targetPercentage),
        type,
      },
    ];
  });
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

function requiredIsoDate(value: unknown, field: string): string {
  const text = requiredString(value, field);
  const time = Date.parse(text);

  if (!Number.isFinite(time)) {
    throw new ValidationError(`${field} must be a valid ISO date`);
  }

  return new Date(time).toISOString();
}

function requireSingleRow<Row>(rows: Row[], message: string): Row {
  const row = rows[0];

  if (!row) {
    throw new Error(message);
  }

  return row;
}

function nullableNumber(value: string | null): number | null {
  return value === null ? null : Number(value);
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
