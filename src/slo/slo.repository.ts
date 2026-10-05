import type { SqlExecutor } from '../database/postgres.js';
import { ValidationError } from '../errors/validation-error.js';
import { requiredString, requireRecord } from '../validation/primitives.js';
import type {
  CreateEvaluationInput,
  CreateSloInput,
  EvaluationObjectiveResult,
  LatestEvaluationRow,
  ProcessControlOptions,
  ProjectRow,
  RollingEvaluationRow,
  RollingObjectiveResult,
  RollingSliWindow,
  ServiceRow,
  SliEvaluationResult,
  SliObjective,
  SliType,
  SloBurnRateResponse,
  SloDefinition,
  SloEvaluationResponse,
  SloProcessControlResponse,
  SloRiskForecastResponse,
  SloRollingWindowsResponse,
  SloRow,
} from './slo.types.js';
import {
  analyzeObjectiveRiskForecast,
  analyzeObjectiveProcessControl,
  calculateObjectiveBurnRate,
  calculateSliEvaluation,
  overallBurnRateSeverity,
  overallRiskForecastSeverity,
  overallProcessControlSeverity,
  overallSloStatus,
  summarizeRollingWindows,
} from './slo.calculations.js';

interface TransactionalSqlExecutor extends SqlExecutor {
  transaction?<Result>(work: (transaction: SqlExecutor) => Promise<Result>): Promise<Result>;
}

export class SloRepository {
  constructor(private readonly database: TransactionalSqlExecutor) {}

  async upsert(input: CreateSloInput): Promise<SloDefinition> {
    return this.withTransaction((repository) => repository.upsertInTransaction(input));
  }

  private async upsertInTransaction(input: CreateSloInput): Promise<SloDefinition> {
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

    await this.deleteRemovedObjectives(
      sloId,
      input.objectives.map((objective) => objective.type),
    );

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
    return this.withTransaction((repository) => repository.evaluateInTransaction(sloId, input));
  }

  private async evaluateInTransaction(
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

  async rollingWindows(
    sloId: string,
    limit: number,
  ): Promise<SloRollingWindowsResponse | undefined> {
    const slo = await this.findById(sloId);

    if (!slo) {
      return undefined;
    }

    const result = await this.database.query<RollingEvaluationRow>(
      `SELECT
         sli.indicator_type,
         sli.latency_threshold_ms,
         ew.window_started_at,
         ew.window_ended_at,
         ew.total_events,
         ew.good_events,
         ew.observed_percentage,
         ew.error_budget_total_events,
         ew.error_budget_consumed_percentage,
         ew.error_budget_remaining_percentage,
         ew.source_kind,
         ew.source_query,
         ew.source_period,
         ew.status
       FROM control_plane.sli_definitions sli
       LEFT JOIN LATERAL (
         SELECT
           window_started_at,
           window_ended_at,
           total_events,
           good_events,
           observed_percentage,
           error_budget_total_events,
           error_budget_consumed_percentage,
           error_budget_remaining_percentage,
           source_kind,
           source_query,
           source_period,
           status
         FROM control_plane.sli_evaluation_windows evaluation_window
         WHERE evaluation_window.sli_id = sli.id
         ORDER BY evaluation_window.window_ended_at DESC
         LIMIT $2
       ) ew ON true
       WHERE sli.slo_id = $1
       ORDER BY sli.indicator_type, ew.window_ended_at ASC NULLS LAST`,
      [sloId, limit],
    );
    const rowsByType = new Map<SliType, RollingEvaluationRow[]>();

    for (const row of result.rows) {
      const rows = rowsByType.get(row.indicator_type) ?? [];
      rows.push(row);
      rowsByType.set(row.indicator_type, rows);
    }

    const objectives = slo.objectives.map((objective): RollingObjectiveResult => {
      const rows = rowsByType.get(objective.type) ?? [];
      const windows = rows.flatMap((row): RollingSliWindow[] => {
        if (
          !row.window_started_at ||
          !row.window_ended_at ||
          row.total_events === null ||
          row.good_events === null ||
          row.status === null
        ) {
          return [];
        }

        const totalEvents = Number(row.total_events);
        const goodEvents = Number(row.good_events);

        return [
          {
            badEvents: totalEvents - goodEvents,
            endedAt: row.window_ended_at.toISOString(),
            errorBudgetConsumedPercentage: nullableNumber(row.error_budget_consumed_percentage),
            errorBudgetRemainingPercentage: nullableNumber(row.error_budget_remaining_percentage),
            errorBudgetTotalEvents: nullableNumber(row.error_budget_total_events),
            goodEvents,
            observedPercentage: nullableNumber(row.observed_percentage),
            source: {
              kind: row.source_kind ?? 'manual',
              ...(row.source_period ? { period: row.source_period } : {}),
              ...(row.source_query ? { query: row.source_query } : {}),
            },
            startedAt: row.window_started_at.toISOString(),
            status: row.status,
            targetPercentage: objective.targetPercentage,
            totalEvents,
          },
        ];
      });

      return {
        ...(objective.latencyThresholdMilliseconds
          ? { latencyThresholdMilliseconds: objective.latencyThresholdMilliseconds }
          : {}),
        summary: summarizeRollingWindows(windows),
        targetPercentage: objective.targetPercentage,
        type: objective.type,
        windows,
      };
    });

    return {
      limit,
      objectives,
      overallStatus: overallSloStatus(
        objectives.map((objective) => ({ status: objective.summary.latestStatus })),
      ),
      slo,
    };
  }

  async burnRate(
    sloId: string,
    input: { longWindowCount: number; shortWindowCount: number },
  ): Promise<SloBurnRateResponse | undefined> {
    const rollingWindows = await this.rollingWindows(sloId, input.longWindowCount);

    if (!rollingWindows) {
      return undefined;
    }

    const objectives = rollingWindows.objectives.map((objective) =>
      calculateObjectiveBurnRate(objective, objective.windows, {
        longWindowCount: input.longWindowCount,
        shortWindowCount: input.shortWindowCount,
        windowDays: rollingWindows.slo.windowDays,
      }),
    );

    return {
      longWindowCount: input.longWindowCount,
      objectives,
      overallSeverity: overallBurnRateSeverity(objectives),
      shortWindowCount: input.shortWindowCount,
      slo: rollingWindows.slo,
    };
  }

  async processControl(
    sloId: string,
    input: ProcessControlOptions & { limit: number },
  ): Promise<SloProcessControlResponse | undefined> {
    const rollingWindows = await this.rollingWindows(sloId, input.limit);

    if (!rollingWindows) {
      return undefined;
    }

    const options: ProcessControlOptions = {
      baselineWindowCount: input.baselineWindowCount,
      ewmaLambda: input.ewmaLambda,
      sigmaMultiplier: input.sigmaMultiplier,
      sustainedWindowCount: input.sustainedWindowCount,
    };
    const objectives = rollingWindows.objectives.map((objective) =>
      analyzeObjectiveProcessControl(objective, objective.windows, options),
    );

    return {
      limit: input.limit,
      objectives,
      options,
      overallSeverity: overallProcessControlSeverity(objectives),
      slo: rollingWindows.slo,
    };
  }

  async riskForecast(
    sloId: string,
    input: { baselineWindowCount: number; limit: number; riskThreshold: number },
  ): Promise<SloRiskForecastResponse | undefined> {
    const rollingWindows = await this.rollingWindows(sloId, input.limit);

    if (!rollingWindows) {
      return undefined;
    }

    const options = {
      baselineWindowCount: input.baselineWindowCount,
      riskThreshold: input.riskThreshold,
    };
    const objectives = rollingWindows.objectives.map((objective) =>
      analyzeObjectiveRiskForecast(objective, objective.windows, options),
    );

    return {
      limit: input.limit,
      objectives,
      options,
      overallSeverity: overallRiskForecastSeverity(objectives),
      slo: rollingWindows.slo,
    };
  }

  private async findById(id: string): Promise<SloDefinition | undefined> {
    const result = await this.database.query<SloRow>(selectSloDefinitionsSql('WHERE slo.id = $1'), [
      id,
    ]);
    const row = result.rows[0];
    return row ? mapSloDefinition(row) : undefined;
  }

  private withTransaction<Result>(
    work: (repository: SloRepository) => Promise<Result>,
  ): Promise<Result> {
    if (!this.database.transaction) {
      return work(this);
    }

    return this.database.transaction((transaction) => work(new SloRepository(transaction)));
  }

  private async deleteRemovedObjectives(sloId: string, objectiveTypes: SliType[]): Promise<void> {
    await this.database.query(
      `DELETE FROM control_plane.sli_definitions
       WHERE slo_id = $1
         AND indicator_type <> ALL($2::text[])`,
      [sloId, objectiveTypes],
    );
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
         source_kind,
         source_query,
         source_period,
         status
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       ON CONFLICT (sli_id, window_started_at, window_ended_at) DO UPDATE SET
         total_events = EXCLUDED.total_events,
         good_events = EXCLUDED.good_events,
         target_percentage_snapshot = EXCLUDED.target_percentage_snapshot,
         observed_percentage = EXCLUDED.observed_percentage,
         error_budget_total_events = EXCLUDED.error_budget_total_events,
         error_budget_consumed_percentage = EXCLUDED.error_budget_consumed_percentage,
         error_budget_remaining_percentage = EXCLUDED.error_budget_remaining_percentage,
         source_kind = EXCLUDED.source_kind,
         source_query = EXCLUDED.source_query,
         source_period = EXCLUDED.source_period,
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
        input.source.kind,
        input.source.query ?? null,
        input.source.period ?? null,
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
