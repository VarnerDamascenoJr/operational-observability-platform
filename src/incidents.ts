import type { FastifyInstance } from 'fastify';

import type { SqlExecutor } from './database/postgres.js';
import { ValidationError } from './errors/validation-error.js';
import type {
  CreateIncidentInput,
  EvidenceInput,
  EvidenceType,
  HypothesisConfidence,
  HypothesisInput,
  IncidentSeverity,
  IncidentStatus,
  SourceAlertInput,
  TimelineEventType,
  TimelineInput,
  UpdateIncidentInput,
} from './incidents/incidents.types.js';
export { canTransitionIncidentStatus } from './incidents/incidents.rules.js';
import { IncidentRepository } from './incidents/incidents.repository.js';
import { slugPattern, uuidPattern } from './validation/patterns.js';

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
