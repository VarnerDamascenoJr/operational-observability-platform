import type { SqlExecutor } from '../database/postgres.js';
import { ValidationError } from '../errors/validation-error.js';
import { encodePaginationCursor } from '../pagination/pagination.validation.js';
import {
  clampConfidenceScore,
  confidenceToScore,
  roundConfidenceScore,
  scoreToConfidence,
  summarizeHypothesisConfidence,
} from './incidents.confidence.js';
import type {
  CreateIncidentInput,
  EvidenceInput,
  HypothesisConfidenceAdjustmentInput,
  HypothesisConfidenceEventRow,
  EvidenceRow,
  HypothesisInput,
  HypothesisRow,
  IncidentListCursor,
  IncidentListInput,
  IncidentListResponse,
  IncidentResponse,
  IncidentRow,
  ProjectInput,
  ProjectRow,
  ServiceInput,
  ServiceRow,
  TimelineInput,
  TimelineRow,
  UpdateIncidentInput,
} from './incidents.types.js';

export class IncidentRepository {
  constructor(private readonly database: SqlExecutor) {}

  async create(input: CreateIncidentInput): Promise<IncidentResponse> {
    const project = await this.upsertProject(input.project);
    const service = await this.upsertService(project.id, input.service);

    if (input.sloId) {
      await this.ensureSloBelongsToService(input.sloId, service.id);
    }

    const result = await this.database.query<{ id: string }>(
      `INSERT INTO control_plane.incidents (
         project_id,
         service_id,
         slo_id,
         title,
         summary,
         severity,
         source_alert_name,
         source_alert_fingerprint,
         source_alert_severity
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id`,
      [
        project.id,
        service.id,
        input.sloId ?? null,
        input.title,
        input.summary ?? null,
        input.severity,
        input.sourceAlert?.name ?? null,
        input.sourceAlert?.fingerprint ?? null,
        input.sourceAlert?.severity ?? null,
      ],
    );
    const incidentId = requireSingleRow(result.rows, 'Incident was not persisted').id;

    await this.insertTimelineEvent(incidentId, {
      title: `Incident opened: ${input.title}`,
      type: 'opened',
    });

    if (input.sourceAlert) {
      await this.insertEvidence(incidentId, {
        description: input.sourceAlert.fingerprint
          ? `Alert fingerprint: ${input.sourceAlert.fingerprint}`
          : undefined,
        title: input.sourceAlert.name,
        type: 'alert',
      });
    }

    for (const evidence of input.evidence) {
      await this.insertEvidence(incidentId, evidence);
    }

    for (const hypothesis of input.hypotheses) {
      await this.insertHypothesis(incidentId, hypothesis);
    }

    const incident = await this.findById(incidentId);

    if (!incident) {
      throw new Error('Incident was created but could not be loaded');
    }

    return incident;
  }

  async list(input: IncidentListInput): Promise<IncidentListResponse> {
    const parameters: unknown[] = [];
    const whereClause = input.cursor
      ? `WHERE (
          incident.detected_at < $1::timestamptz
          OR (
            incident.detected_at = $1::timestamptz
            AND incident.created_at < $2::timestamptz
          )
          OR (
            incident.detected_at = $1::timestamptz
            AND incident.created_at = $2::timestamptz
            AND incident.id < $3::uuid
          )
        )`
      : '';

    if (input.cursor) {
      parameters.push(input.cursor.detectedAt, input.cursor.createdAt, input.cursor.id);
    }

    parameters.push(input.limit + 1);

    const result = await this.database.query<IncidentRow>(
      selectIncidentSql(
        whereClause,
        `ORDER BY ${incidentListOrderSql} LIMIT $${parameters.length}`,
      ),
      parameters,
    );
    const pageRows = result.rows.slice(0, input.limit);
    const incidents = await Promise.all(pageRows.map((row) => this.hydrate(row)));

    return {
      incidents,
      limit: input.limit,
      ...(result.rows.length > input.limit && pageRows.length > 0
        ? { nextCursor: encodeIncidentListCursor(pageRows[pageRows.length - 1]) }
        : {}),
    };
  }

  async findById(incidentId: string): Promise<IncidentResponse | undefined> {
    const result = await this.database.query<IncidentRow>(
      selectIncidentSql('WHERE incident.id = $1'),
      [incidentId],
    );
    const row = result.rows[0];
    return row ? this.hydrate(row) : undefined;
  }

  async updateExisting(
    incidentId: string,
    input: UpdateIncidentInput,
    current: IncidentResponse,
  ): Promise<IncidentResponse> {
    const nextStatus = input.status ?? current.status;

    await this.database.query(
      `UPDATE control_plane.incidents
       SET
         title = COALESCE($2, title),
         summary = COALESCE($3, summary),
         severity = COALESCE($4, severity),
         status = $5,
         root_cause = COALESCE($6, root_cause),
         preventive_actions = COALESCE($7, preventive_actions),
         resolved_at = CASE
           WHEN $5 = 'resolved' AND resolved_at IS NULL THEN now()
           WHEN $5 <> 'resolved' THEN NULL
           ELSE resolved_at
         END,
         updated_at = now()
       WHERE id = $1`,
      [
        incidentId,
        input.title ?? null,
        input.summary ?? null,
        input.severity ?? null,
        nextStatus,
        input.rootCause ?? null,
        input.preventiveActions ?? null,
      ],
    );

    if (nextStatus !== current.status) {
      await this.insertTimelineEvent(incidentId, {
        description: `Status changed from ${current.status} to ${nextStatus}`,
        title: nextStatus === 'resolved' ? 'Incident resolved' : `Incident marked ${nextStatus}`,
        type: nextStatus === 'resolved' ? 'resolved' : 'status_changed',
      });
    }

    const incident = await this.findById(incidentId);

    if (!incident) {
      throw new Error('Incident was updated but could not be loaded');
    }

    return incident;
  }

  async addEvidence(
    incidentId: string,
    input: EvidenceInput,
  ): Promise<IncidentResponse | undefined> {
    if (!(await this.exists(incidentId))) {
      return undefined;
    }

    await this.insertEvidence(incidentId, input);
    await this.insertTimelineEvent(incidentId, {
      title: `Evidence added: ${input.title}`,
      type: 'evidence_added',
    });

    return this.findById(incidentId);
  }

  async addHypothesis(
    incidentId: string,
    input: HypothesisInput,
  ): Promise<IncidentResponse | undefined> {
    if (!(await this.exists(incidentId))) {
      return undefined;
    }

    await this.insertHypothesis(incidentId, input);
    await this.insertTimelineEvent(incidentId, {
      title: 'Hypothesis added',
      type: 'hypothesis_added',
    });

    return this.findById(incidentId);
  }

  async adjustHypothesisConfidence(
    incidentId: string,
    hypothesisId: string,
    input: HypothesisConfidenceAdjustmentInput,
  ): Promise<IncidentResponse | undefined> {
    const currentResult = await this.database.query<{
      confidence_score: string;
      id: string;
    }>(
      `SELECT id, confidence_score
       FROM control_plane.incident_hypotheses
       WHERE id = $1 AND incident_id = $2`,
      [hypothesisId, incidentId],
    );
    const current = currentResult.rows[0];

    if (!current) {
      return undefined;
    }

    if (input.evidenceId) {
      await this.ensureEvidenceBelongsToIncident(input.evidenceId, incidentId);
    }

    const previousScore = Number(current.confidence_score);
    const nextScore = clampConfidenceScore(previousScore + input.scoreDelta);
    const scoreDelta = roundConfidenceScore(nextScore - previousScore);
    const confidence = scoreToConfidence(nextScore);

    await this.database.query(
      `UPDATE control_plane.incident_hypotheses
       SET confidence = $3,
           confidence_score = $4,
           updated_at = now()
       WHERE id = $1 AND incident_id = $2`,
      [hypothesisId, incidentId, confidence, nextScore],
    );
    await this.insertHypothesisConfidenceEvent(incidentId, hypothesisId, {
      evidenceId: input.evidenceId,
      nextScore,
      previousScore,
      reason: input.reason,
      scoreDelta,
    });

    return this.findById(incidentId);
  }

  async addTimelineEvent(
    incidentId: string,
    input: TimelineInput,
  ): Promise<IncidentResponse | undefined> {
    if (!(await this.exists(incidentId))) {
      return undefined;
    }

    await this.insertTimelineEvent(incidentId, input);
    return this.findById(incidentId);
  }

  private async hydrate(row: IncidentRow): Promise<IncidentResponse> {
    const [evidenceResult, hypothesesResult, confidenceHistoryResult, timelineResult] =
      await Promise.all([
        this.database.query<EvidenceRow>(
          `SELECT id, evidence_type, title, url, description, created_at
         FROM control_plane.incident_evidences
         WHERE incident_id = $1
         ORDER BY created_at, id`,
          [row.id],
        ),
        this.database.query<HypothesisRow>(
          `SELECT id, statement, confidence, confidence_score, status, created_at, updated_at
         FROM control_plane.incident_hypotheses
         WHERE incident_id = $1
         ORDER BY created_at, id`,
          [row.id],
        ),
        this.database.query<HypothesisConfidenceEventRow>(
          `SELECT
           confidence_event.id,
           confidence_event.hypothesis_id,
           confidence_event.evidence_id,
           evidence.title AS evidence_title,
           confidence_event.previous_score,
           confidence_event.score_delta,
           confidence_event.next_score,
           confidence_event.reason,
           confidence_event.created_at
         FROM control_plane.incident_hypothesis_confidence_events confidence_event
         LEFT JOIN control_plane.incident_evidences evidence
           ON evidence.id = confidence_event.evidence_id
         WHERE confidence_event.incident_id = $1
         ORDER BY confidence_event.created_at, confidence_event.id`,
          [row.id],
        ),
        this.database.query<TimelineRow>(
          `SELECT id, event_type, title, description, occurred_at, created_at
         FROM control_plane.incident_timeline_events
         WHERE incident_id = $1
         ORDER BY occurred_at, created_at, id`,
          [row.id],
        ),
      ]);

    return mapIncident(
      row,
      evidenceResult.rows,
      hypothesesResult.rows,
      confidenceHistoryResult.rows,
      timelineResult.rows,
    );
  }

  private async exists(incidentId: string): Promise<boolean> {
    const result = await this.database.query<{ exists: boolean }>(
      'SELECT EXISTS (SELECT 1 FROM control_plane.incidents WHERE id = $1) AS exists',
      [incidentId],
    );
    return result.rows[0]?.exists ?? false;
  }

  private async ensureSloBelongsToService(sloId: string, serviceId: string): Promise<void> {
    const result = await this.database.query<{ exists: boolean }>(
      'SELECT EXISTS (SELECT 1 FROM control_plane.slo_definitions WHERE id = $1 AND service_id = $2) AS exists',
      [sloId, serviceId],
    );

    if (!result.rows[0]?.exists) {
      throw new ValidationError('sloId must belong to the incident service');
    }
  }

  private async ensureEvidenceBelongsToIncident(
    evidenceId: string,
    incidentId: string,
  ): Promise<void> {
    const result = await this.database.query<{ exists: boolean }>(
      'SELECT EXISTS (SELECT 1 FROM control_plane.incident_evidences WHERE id = $1 AND incident_id = $2) AS exists',
      [evidenceId, incidentId],
    );

    if (!result.rows[0]?.exists) {
      throw new ValidationError('evidenceId must belong to the incident');
    }
  }

  private async insertEvidence(incidentId: string, input: EvidenceInput): Promise<void> {
    await this.database.query(
      `INSERT INTO control_plane.incident_evidences (
         incident_id, evidence_type, title, url, description
       ) VALUES ($1, $2, $3, $4, $5)`,
      [incidentId, input.type, input.title, input.url ?? null, input.description ?? null],
    );
  }

  private async insertHypothesis(incidentId: string, input: HypothesisInput): Promise<void> {
    const confidenceScore = confidenceToScore(input.confidence);
    const result = await this.database.query<{ id: string }>(
      `INSERT INTO control_plane.incident_hypotheses (
         incident_id, statement, confidence, confidence_score
       ) VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [incidentId, input.statement, input.confidence, confidenceScore],
    );
    const hypothesisId = requireSingleRow(result.rows, 'Hypothesis was not persisted').id;

    await this.insertHypothesisConfidenceEvent(incidentId, hypothesisId, {
      nextScore: confidenceScore,
      previousScore: confidenceScore,
      reason: `Initial ${input.confidence} confidence`,
      scoreDelta: 0,
    });
  }

  private async insertHypothesisConfidenceEvent(
    incidentId: string,
    hypothesisId: string,
    input: {
      evidenceId?: string;
      nextScore: number;
      previousScore: number;
      reason: string;
      scoreDelta: number;
    },
  ): Promise<void> {
    await this.database.query(
      `INSERT INTO control_plane.incident_hypothesis_confidence_events (
         incident_id,
         hypothesis_id,
         evidence_id,
         previous_score,
         score_delta,
         next_score,
         reason
       ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        incidentId,
        hypothesisId,
        input.evidenceId ?? null,
        input.previousScore,
        input.scoreDelta,
        input.nextScore,
        input.reason,
      ],
    );
  }

  private async insertTimelineEvent(incidentId: string, input: TimelineInput): Promise<void> {
    await this.database.query(
      `INSERT INTO control_plane.incident_timeline_events (
         incident_id, event_type, title, description, occurred_at
       ) VALUES ($1, $2, $3, $4, $5)`,
      [
        incidentId,
        input.type,
        input.title,
        input.description ?? null,
        input.occurredAt ?? new Date().toISOString(),
      ],
    );
  }

  private async upsertProject(input: ProjectInput): Promise<ProjectRow> {
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

  private async upsertService(projectId: string, input: ServiceInput): Promise<ServiceRow> {
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

const incidentListOrderSql =
  'incident.detected_at DESC, incident.created_at DESC, incident.id DESC';

function selectIncidentSql(
  whereClause: string,
  suffix = `ORDER BY ${incidentListOrderSql}`,
): string {
  return `SELECT
      incident.id,
      incident.project_id,
      incident.service_id,
      incident.slo_id,
      incident.title,
      incident.summary,
      incident.severity,
      incident.status,
      incident.source_alert_name,
      incident.source_alert_fingerprint,
      incident.source_alert_severity,
      incident.detected_at,
      incident.resolved_at,
      incident.root_cause,
      incident.preventive_actions,
      incident.created_at,
      incident.updated_at,
      project.slug AS project_slug,
      project.name AS project_name,
      service.slug AS service_slug,
      service.name AS service_name,
      service.owner AS service_owner,
      service.environment AS service_environment
    FROM control_plane.incidents incident
    JOIN control_plane.projects project ON project.id = incident.project_id
    JOIN control_plane.services service ON service.id = incident.service_id
    ${whereClause}
    ${suffix}`;
}

function encodeIncidentListCursor(row: IncidentRow): string {
  const cursor: IncidentListCursor = {
    createdAt: row.created_at.toISOString(),
    detectedAt: row.detected_at.toISOString(),
    id: row.id,
  };

  return encodePaginationCursor(cursor);
}

function mapIncident(
  row: IncidentRow,
  evidenceRows: EvidenceRow[],
  hypothesisRows: HypothesisRow[],
  confidenceHistoryRows: HypothesisConfidenceEventRow[],
  timelineRows: TimelineRow[],
): IncidentResponse {
  const hypotheses = hypothesisRows.map((row) => mapHypothesis(row, confidenceHistoryRows));

  return {
    createdAt: row.created_at.toISOString(),
    detectedAt: row.detected_at.toISOString(),
    evidence: evidenceRows.map(mapEvidence),
    hypotheses,
    hypothesisSummary: summarizeHypothesisConfidence(hypotheses),
    id: row.id,
    ...(row.preventive_actions ? { preventiveActions: row.preventive_actions } : {}),
    project: {
      id: row.project_id,
      name: row.project_name,
      slug: row.project_slug,
    },
    ...(row.resolved_at ? { resolvedAt: row.resolved_at.toISOString() } : {}),
    ...(row.root_cause ? { rootCause: row.root_cause } : {}),
    service: {
      environment: row.service_environment,
      id: row.service_id,
      name: row.service_name,
      ...(row.service_owner ? { owner: row.service_owner } : {}),
      slug: row.service_slug,
    },
    severity: row.severity,
    ...(row.slo_id ? { sloId: row.slo_id } : {}),
    ...(row.source_alert_name
      ? {
          sourceAlert: {
            ...(row.source_alert_fingerprint ? { fingerprint: row.source_alert_fingerprint } : {}),
            name: row.source_alert_name,
            ...(row.source_alert_severity ? { severity: row.source_alert_severity } : {}),
          },
        }
      : {}),
    status: row.status,
    ...(row.summary ? { summary: row.summary } : {}),
    timeline: timelineRows.map(mapTimeline),
    title: row.title,
    updatedAt: row.updated_at.toISOString(),
  };
}

function mapEvidence(row: EvidenceRow): IncidentResponse['evidence'][number] {
  return {
    createdAt: row.created_at.toISOString(),
    ...(row.description ? { description: row.description } : {}),
    id: row.id,
    title: row.title,
    type: row.evidence_type,
    ...(row.url ? { url: row.url } : {}),
  };
}

function mapHypothesis(
  row: HypothesisRow,
  confidenceHistoryRows: HypothesisConfidenceEventRow[],
): IncidentResponse['hypotheses'][number] {
  return {
    confidence: row.confidence,
    confidenceHistory: confidenceHistoryRows
      .filter((history) => history.hypothesis_id === row.id)
      .map(mapHypothesisConfidenceEvent),
    confidenceScore: Number(row.confidence_score),
    createdAt: row.created_at.toISOString(),
    id: row.id,
    statement: row.statement,
    status: row.status,
    updatedAt: row.updated_at.toISOString(),
  };
}

function mapHypothesisConfidenceEvent(
  row: HypothesisConfidenceEventRow,
): IncidentResponse['hypotheses'][number]['confidenceHistory'][number] {
  return {
    createdAt: row.created_at.toISOString(),
    ...(row.evidence_id && row.evidence_title
      ? {
          evidence: {
            id: row.evidence_id,
            title: row.evidence_title,
          },
        }
      : {}),
    id: row.id,
    nextScore: Number(row.next_score),
    previousScore: Number(row.previous_score),
    reason: row.reason,
    scoreDelta: Number(row.score_delta),
  };
}

function mapTimeline(row: TimelineRow): IncidentResponse['timeline'][number] {
  return {
    createdAt: row.created_at.toISOString(),
    ...(row.description ? { description: row.description } : {}),
    id: row.id,
    occurredAt: row.occurred_at.toISOString(),
    title: row.title,
    type: row.event_type,
  };
}

function requireSingleRow<Row>(rows: Row[], message: string): Row {
  const row = rows[0];

  if (!row) {
    throw new Error(message);
  }

  return row;
}
