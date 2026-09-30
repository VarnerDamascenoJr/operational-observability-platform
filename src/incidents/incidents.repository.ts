import type { SqlExecutor } from '../database/postgres.js';
import { ValidationError } from '../errors/validation-error.js';
import type {
  CreateIncidentInput,
  EvidenceInput,
  EvidenceRow,
  HypothesisInput,
  HypothesisRow,
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

  async list(): Promise<IncidentResponse[]> {
    const result = await this.database.query<IncidentRow>(selectIncidentSql(''));
    return Promise.all(result.rows.map((row) => this.hydrate(row)));
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
    const [evidenceResult, hypothesesResult, timelineResult] = await Promise.all([
      this.database.query<EvidenceRow>(
        `SELECT id, evidence_type, title, url, description, created_at
         FROM control_plane.incident_evidences
         WHERE incident_id = $1
         ORDER BY created_at, id`,
        [row.id],
      ),
      this.database.query<HypothesisRow>(
        `SELECT id, statement, confidence, status, created_at, updated_at
         FROM control_plane.incident_hypotheses
         WHERE incident_id = $1
         ORDER BY created_at, id`,
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

    return mapIncident(row, evidenceResult.rows, hypothesesResult.rows, timelineResult.rows);
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

  private async insertEvidence(incidentId: string, input: EvidenceInput): Promise<void> {
    await this.database.query(
      `INSERT INTO control_plane.incident_evidences (
         incident_id, evidence_type, title, url, description
       ) VALUES ($1, $2, $3, $4, $5)`,
      [incidentId, input.type, input.title, input.url ?? null, input.description ?? null],
    );
  }

  private async insertHypothesis(incidentId: string, input: HypothesisInput): Promise<void> {
    await this.database.query(
      `INSERT INTO control_plane.incident_hypotheses (
         incident_id, statement, confidence
       ) VALUES ($1, $2, $3)`,
      [incidentId, input.statement, input.confidence],
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

function selectIncidentSql(whereClause: string): string {
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
    ORDER BY incident.detected_at DESC, incident.created_at DESC`;
}

function mapIncident(
  row: IncidentRow,
  evidenceRows: EvidenceRow[],
  hypothesisRows: HypothesisRow[],
  timelineRows: TimelineRow[],
): IncidentResponse {
  return {
    createdAt: row.created_at.toISOString(),
    detectedAt: row.detected_at.toISOString(),
    evidence: evidenceRows.map(mapEvidence),
    hypotheses: hypothesisRows.map(mapHypothesis),
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

function mapHypothesis(row: HypothesisRow): IncidentResponse['hypotheses'][number] {
  return {
    confidence: row.confidence,
    createdAt: row.created_at.toISOString(),
    id: row.id,
    statement: row.statement,
    status: row.status,
    updatedAt: row.updated_at.toISOString(),
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
