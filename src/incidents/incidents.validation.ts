import { ValidationError } from '../errors/validation-error.js';
import {
  decodePaginationCursor,
  parsePaginationInput,
} from '../common/pagination/pagination.validation.js';
import { isNil } from '../utils/presence.js';
import {
  optionalString,
  optionalUuid,
  parseOptionalArray,
  requiredEnum,
  requiredIsoDate,
  requiredNumber,
  requiredSlug,
  requiredString,
  requiredUuid,
  requireRecord,
} from '../validation/primitives.js';
import type {
  CreateIncidentInput,
  EvidenceInput,
  EvidenceType,
  HypothesisConfidenceAdjustmentInput,
  HypothesisConfidence,
  HypothesisInput,
  IncidentListCursor,
  IncidentListInput,
  IncidentSeverity,
  IncidentStatus,
  SourceAlertInput,
  TimelineEventType,
  TimelineInput,
  UpdateIncidentInput,
} from './incidents.types.js';

export function parseCreateIncidentInput(value: unknown): CreateIncidentInput {
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

export function parseUpdateIncidentInput(value: unknown): UpdateIncidentInput {
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

export function parseIncidentListInput(value: unknown): IncidentListInput {
  return parsePaginationInput(value, {
    defaultLimit: 50,
    maximumLimit: 100,
    parseCursor: parseIncidentListCursor,
  });
}

export function parseEvidenceInput(value: unknown): EvidenceInput {
  const body = requireRecord(value, 'evidence must be an object');

  return {
    description: optionalString(body.description, 'evidence.description'),
    title: requiredString(body.title, 'evidence.title'),
    type: requiredEvidenceType(body.type, 'evidence.type'),
    url: optionalUrl(body.url, 'evidence.url'),
  };
}

export function parseHypothesisInput(value: unknown): HypothesisInput {
  const body = requireRecord(value, 'hypothesis must be an object');

  return {
    confidence: requiredHypothesisConfidence(body.confidence, 'hypothesis.confidence'),
    statement: requiredString(body.statement, 'hypothesis.statement'),
  };
}

export function parseHypothesisConfidenceAdjustmentInput(
  value: unknown,
): HypothesisConfidenceAdjustmentInput {
  const body = requireRecord(value, 'hypothesis confidence adjustment must be an object');

  return {
    evidenceId: optionalUuid(body.evidenceId, 'hypothesisConfidence.evidenceId'),
    reason: requiredString(body.reason, 'hypothesisConfidence.reason'),
    scoreDelta: requiredConfidenceDelta(body.scoreDelta, 'hypothesisConfidence.scoreDelta'),
  };
}

export function parseTimelineInput(value: unknown): TimelineInput {
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

export function parseIncidentId(value: unknown): string {
  const params = requireRecord(value, 'Route params must be an object');
  return requiredUuid(params.incidentId, 'incidentId');
}

export function parseIncidentHypothesisIds(value: unknown): {
  hypothesisId: string;
  incidentId: string;
} {
  const params = requireRecord(value, 'Route params must be an object');

  return {
    hypothesisId: requiredUuid(params.hypothesisId, 'hypothesisId'),
    incidentId: requiredUuid(params.incidentId, 'incidentId'),
  };
}

function parseOptionalSourceAlert(value: unknown): SourceAlertInput | undefined {
  if (isNil(value)) {
    return undefined;
  }

  const body = requireRecord(value, 'sourceAlert must be an object');

  return {
    fingerprint: optionalString(body.fingerprint, 'sourceAlert.fingerprint'),
    name: requiredString(body.name, 'sourceAlert.name'),
    severity: optionalString(body.severity, 'sourceAlert.severity'),
  };
}

function parseIncidentListCursor(value: unknown): IncidentListCursor {
  try {
    const encodedCursor = requiredString(value, 'cursor');
    const decoded = decodePaginationCursor(
      encodedCursor,
      'cursor must be a valid incident list cursor',
    );
    const cursor = requireRecord(decoded, 'cursor must be a valid incident list cursor');

    return {
      createdAt: requiredCursorTimestamp(cursor.createdAt, 'cursor.createdAt'),
      detectedAt: requiredCursorTimestamp(cursor.detectedAt, 'cursor.detectedAt'),
      id: requiredUuid(cursor.id, 'cursor.id'),
    };
  } catch (error) {
    if (error instanceof ValidationError) {
      throw error;
    }

    throw new ValidationError('cursor must be a valid incident list cursor');
  }
}

function requiredCursorTimestamp(value: unknown, field: string): string {
  const timestamp = requiredString(value, field);

  if (!cursorTimestampPattern.test(timestamp) || !Number.isFinite(Date.parse(timestamp))) {
    throw new ValidationError(`${field} must be a valid ISO date`);
  }

  return timestamp;
}

function optionalUrl(value: unknown, field: string): string | undefined {
  const url = optionalString(value, field);

  if (url === undefined) {
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

const cursorTimestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/;

function requiredConfidenceDelta(value: unknown, field: string): number {
  const delta = requiredNumber(value, field);

  if (delta < -1 || delta > 1 || delta === 0) {
    throw new ValidationError(`${field} must be between -1 and 1 and cannot be zero`);
  }

  return Math.round(delta * 10000) / 10000;
}

function requiredIncidentSeverity(value: unknown, field: string): IncidentSeverity {
  return requiredEnum(
    value,
    field,
    ['info', 'warning', 'page', 'critical'] as const,
    'info, warning, page or critical',
  );
}

function requiredIncidentStatus(value: unknown, field: string): IncidentStatus {
  return requiredEnum(
    value,
    field,
    ['open', 'investigating', 'mitigated', 'resolved'] as const,
    'open, investigating, mitigated or resolved',
  );
}

function requiredEvidenceType(value: unknown, field: string): EvidenceType {
  return requiredEnum(
    value,
    field,
    ['alert', 'dashboard', 'trace', 'log', 'runbook', 'note'] as const,
    'alert, dashboard, trace, log, runbook or note',
  );
}

function requiredHypothesisConfidence(value: unknown, field: string): HypothesisConfidence {
  return requiredEnum(value, field, ['low', 'medium', 'high'] as const, 'low, medium or high');
}

function requiredTimelineEventType(value: unknown, field: string): TimelineEventType {
  return requiredEnum(
    value,
    field,
    ['opened', 'status_changed', 'evidence_added', 'hypothesis_added', 'note', 'resolved'] as const,
    'opened, status_changed, evidence_added, hypothesis_added, note or resolved',
  );
}
