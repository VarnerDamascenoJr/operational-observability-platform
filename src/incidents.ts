import type { FastifyInstance } from 'fastify';

import type { SqlExecutor } from './database/postgres.js';
import type {
  CreateIncidentInput,
  EvidenceInput,
  EvidenceRow,
  EvidenceType,
  HypothesisConfidence,
  HypothesisInput,
  HypothesisRow,
  IncidentResponse,
  IncidentRow,
  IncidentSeverity,
  IncidentStatus,
  ProjectInput,
  ProjectRow,
  ServiceInput,
  ServiceRow,
  SourceAlertInput,
  TimelineEventType,
  TimelineInput,
  TimelineRow,
  UpdateIncidentInput,
} from './incidents.types.js';
import { slugPattern, uuidPattern } from './validation/patterns.js';

class ValidationError extends Error {}

export function canTransitionIncidentStatus(
  currentStatus: IncidentStatus,
  nextStatus: IncidentStatus,
): boolean {
  if (currentStatus === nextStatus) {
    return true;
  }

  if (currentStatus === 'resolved') {
    return false;
  }

  const allowedTransitions: Record<IncidentStatus, IncidentStatus[]> = {
    investigating: ['mitigated', 'resolved'],
    mitigated: ['investigating', 'resolved'],
    open: ['investigating', 'mitigated', 'resolved'],
    resolved: [],
  };

  return allowedTransitions[currentStatus].includes(nextStatus);
}

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
      const repository = new IncidentRepository(database);
      const incident = await repository.create(input);
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

    const repository = new IncidentRepository(database);
    return { incidents: await repository.list() };
  });

  app.get('/incidents/:incidentId', async (request, reply) => {
    if (!database) {
      void reply.code(503);
      return { error: 'PostgreSQL is required to read incidents' };
    }

    try {
      const incidentId = parseIncidentId(request.params);
      const repository = new IncidentRepository(database);
      const incident = await repository.findById(incidentId);

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
      const repository = new IncidentRepository(database);
      const incident = await repository.update(incidentId, input);

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
      const repository = new IncidentRepository(database);
      const incident = await repository.addEvidence(incidentId, input);

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
      const repository = new IncidentRepository(database);
      const incident = await repository.addHypothesis(incidentId, input);

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
      const repository = new IncidentRepository(database);
      const incident = await repository.addTimelineEvent(incidentId, input);

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

class IncidentRepository {
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

  async update(
    incidentId: string,
    input: UpdateIncidentInput,
  ): Promise<IncidentResponse | undefined> {
    const current = await this.findById(incidentId);

    if (!current) {
      return undefined;
    }

    const nextStatus = input.status ?? current.status;

    if (!canTransitionIncidentStatus(current.status, nextStatus)) {
      throw new ValidationError(`Incident cannot move from ${current.status} to ${nextStatus}`);
    }

    if (nextStatus === 'resolved') {
      if (!input.rootCause && !current.rootCause) {
        throw new ValidationError('rootCause is required when resolving an incident');
      }

      if (!input.preventiveActions && !current.preventiveActions) {
        throw new ValidationError('preventiveActions is required when resolving an incident');
      }
    }

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

    return this.findById(incidentId);
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

function parseCreateIncidentInput(value: unknown): CreateIncidentInput {
  const body = requireRecord(value, 'Request body must be an object');
  const project = requireRecord(body.project, 'project must be an object');
  const service = requireRecord(body.service, 'service must be an object');

  return {
    evidence: parseOptionalArray(body.evidence, parseEvidenceInput),
    hypotheses: parseOptionalArray(body.hypotheses, parseHypothesisInput),
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
    severity: requiredIncidentSeverity(body.severity, 'severity'),
    sloId: optionalUuid(body.sloId, 'sloId'),
    sourceAlert: parseOptionalSourceAlert(body.sourceAlert),
    summary: optionalString(body.summary, 'summary'),
    title: requiredString(body.title, 'title'),
  };
}

function parseUpdateIncidentInput(value: unknown): UpdateIncidentInput {
  const body = requireRecord(value, 'Request body must be an object');
  const input: UpdateIncidentInput = {
    preventiveActions: optionalString(body.preventiveActions, 'preventiveActions'),
    rootCause: optionalString(body.rootCause, 'rootCause'),
    severity:
      body.severity === undefined ? undefined : requiredIncidentSeverity(body.severity, 'severity'),
    status: body.status === undefined ? undefined : requiredIncidentStatus(body.status, 'status'),
    summary: optionalString(body.summary, 'summary'),
    title: optionalString(body.title, 'title'),
  };

  if (Object.values(input).every((value) => value === undefined)) {
    throw new ValidationError('At least one incident field must be updated');
  }

  return input;
}

function parseEvidenceInput(value: unknown): EvidenceInput {
  const body = requireRecord(value, 'evidence must be an object');

  return {
    description: optionalString(body.description, 'evidence.description'),
    title: requiredString(body.title, 'evidence.title'),
    type: requiredEvidenceType(body.type, 'evidence.type'),
    url: optionalUrl(body.url, 'evidence.url'),
  };
}

function parseHypothesisInput(value: unknown): HypothesisInput {
  const body = requireRecord(value, 'hypothesis must be an object');

  return {
    confidence: requiredHypothesisConfidence(body.confidence, 'hypothesis.confidence'),
    statement: requiredString(body.statement, 'hypothesis.statement'),
  };
}

function parseTimelineInput(value: unknown): TimelineInput {
  const body = requireRecord(value, 'timeline event must be an object');

  return {
    description: optionalString(body.description, 'timeline.description'),
    occurredAt:
      body.occurredAt === undefined
        ? undefined
        : requiredIsoDate(body.occurredAt, 'timeline.occurredAt'),
    title: requiredString(body.title, 'timeline.title'),
    type: requiredTimelineEventType(body.type, 'timeline.type'),
  };
}

function parseOptionalSourceAlert(value: unknown): SourceAlertInput | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  const body = requireRecord(value, 'sourceAlert must be an object');

  return {
    fingerprint: optionalString(body.fingerprint, 'sourceAlert.fingerprint'),
    name: requiredString(body.name, 'sourceAlert.name'),
    severity: optionalString(body.severity, 'sourceAlert.severity'),
  };
}

function parseOptionalArray<Item>(value: unknown, parser: (entry: unknown) => Item): Item[] {
  if (value === undefined || value === null) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new ValidationError('Expected an array');
  }

  return value.map(parser);
}

function parseIncidentId(value: unknown): string {
  const params = requireRecord(value, 'Route params must be an object');
  return requiredUuid(params.incidentId, 'incidentId');
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

function requireRecord(value: unknown, message: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ValidationError(message);
  }

  return value as Record<string, unknown>;
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

function requiredUuid(value: unknown, field: string): string {
  const id = requiredString(value, field);

  if (!uuidPattern.test(id)) {
    throw new ValidationError(`${field} must be a UUID`);
  }

  return id;
}

function optionalUuid(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  return requiredUuid(value, field);
}

function optionalUrl(value: unknown, field: string): string | undefined {
  const url = optionalString(value, field);

  if (!url) {
    return undefined;
  }

  try {
    const parsed = new URL(url);

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new ValidationError(`${field} must be an HTTP URL`);
    }
  } catch {
    throw new ValidationError(`${field} must be a valid HTTP URL`);
  }

  return url;
}

function requiredIsoDate(value: unknown, field: string): string {
  const text = requiredString(value, field);
  const time = Date.parse(text);

  if (!Number.isFinite(time)) {
    throw new ValidationError(`${field} must be a valid ISO date`);
  }

  return new Date(time).toISOString();
}

function requiredIncidentSeverity(value: unknown, field: string): IncidentSeverity {
  if (value === 'critical' || value === 'info' || value === 'page' || value === 'warning') {
    return value;
  }

  throw new ValidationError(`${field} must be info, warning, page or critical`);
}

function requiredIncidentStatus(value: unknown, field: string): IncidentStatus {
  if (
    value === 'investigating' ||
    value === 'mitigated' ||
    value === 'open' ||
    value === 'resolved'
  ) {
    return value;
  }

  throw new ValidationError(`${field} must be open, investigating, mitigated or resolved`);
}

function requiredEvidenceType(value: unknown, field: string): EvidenceType {
  if (
    value === 'alert' ||
    value === 'dashboard' ||
    value === 'log' ||
    value === 'note' ||
    value === 'runbook' ||
    value === 'trace'
  ) {
    return value;
  }

  throw new ValidationError(`${field} must be alert, dashboard, trace, log, runbook or note`);
}

function requiredHypothesisConfidence(value: unknown, field: string): HypothesisConfidence {
  if (value === 'high' || value === 'low' || value === 'medium') {
    return value;
  }

  throw new ValidationError(`${field} must be low, medium or high`);
}

function requiredTimelineEventType(value: unknown, field: string): TimelineEventType {
  if (
    value === 'evidence_added' ||
    value === 'hypothesis_added' ||
    value === 'note' ||
    value === 'opened' ||
    value === 'resolved' ||
    value === 'status_changed'
  ) {
    return value;
  }

  throw new ValidationError(
    `${field} must be opened, status_changed, evidence_added, hypothesis_added, note or resolved`,
  );
}

function requireSingleRow<Row>(rows: Row[], message: string): Row {
  const row = rows[0];

  if (!row) {
    throw new Error(message);
  }

  return row;
}
