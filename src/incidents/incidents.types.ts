import type { QueryResultRow } from 'pg';

export type IncidentSeverity = 'critical' | 'info' | 'page' | 'warning';
export type IncidentStatus = 'investigating' | 'mitigated' | 'open' | 'resolved';
export type EvidenceType = 'alert' | 'dashboard' | 'log' | 'note' | 'runbook' | 'trace';
export type HypothesisConfidence = 'high' | 'low' | 'medium';
export type HypothesisStatus = 'open' | 'rejected' | 'supported';
export type TimelineEventType =
  'evidence_added' | 'hypothesis_added' | 'note' | 'opened' | 'resolved' | 'status_changed';

export interface ProjectInput {
  description?: string;
  name: string;
  slug: string;
}

export interface ServiceInput {
  environment: string;
  name: string;
  owner?: string;
  slug: string;
}

export interface SourceAlertInput {
  fingerprint?: string;
  name: string;
  severity?: string;
}

export interface EvidenceInput {
  description?: string;
  title: string;
  type: EvidenceType;
  url?: string;
}

export interface HypothesisInput {
  confidence: HypothesisConfidence;
  statement: string;
}

export interface TimelineInput {
  description?: string;
  occurredAt?: string;
  title: string;
  type: TimelineEventType;
}

export interface CreateIncidentInput {
  evidence: EvidenceInput[];
  hypotheses: HypothesisInput[];
  project: ProjectInput;
  service: ServiceInput;
  severity: IncidentSeverity;
  sloId?: string;
  sourceAlert?: SourceAlertInput;
  summary?: string;
  title: string;
}

export interface UpdateIncidentInput {
  preventiveActions?: string;
  rootCause?: string;
  severity?: IncidentSeverity;
  status?: IncidentStatus;
  summary?: string;
  title?: string;
}

export interface ProjectRow extends QueryResultRow {
  id: string;
  name: string;
  slug: string;
}

export interface ServiceRow extends QueryResultRow {
  environment: string;
  id: string;
  name: string;
  owner: string | null;
  slug: string;
}

export interface IncidentRow extends QueryResultRow {
  created_at: Date;
  detected_at: Date;
  id: string;
  preventive_actions: string | null;
  project_id: string;
  project_name: string;
  project_slug: string;
  resolved_at: Date | null;
  root_cause: string | null;
  service_environment: string;
  service_id: string;
  service_name: string;
  service_owner: string | null;
  service_slug: string;
  severity: IncidentSeverity;
  slo_id: string | null;
  source_alert_fingerprint: string | null;
  source_alert_name: string | null;
  source_alert_severity: string | null;
  status: IncidentStatus;
  summary: string | null;
  title: string;
  updated_at: Date;
}

export interface EvidenceRow extends QueryResultRow {
  created_at: Date;
  description: string | null;
  evidence_type: EvidenceType;
  id: string;
  title: string;
  url: string | null;
}

export interface HypothesisRow extends QueryResultRow {
  confidence: HypothesisConfidence;
  created_at: Date;
  id: string;
  statement: string;
  status: HypothesisStatus;
  updated_at: Date;
}

export interface TimelineRow extends QueryResultRow {
  created_at: Date;
  description: string | null;
  event_type: TimelineEventType;
  id: string;
  occurred_at: Date;
  title: string;
}

export interface IncidentResponse {
  createdAt: string;
  detectedAt: string;
  evidence: Array<{
    createdAt: string;
    description?: string;
    id: string;
    title: string;
    type: EvidenceType;
    url?: string;
  }>;
  hypotheses: Array<{
    confidence: HypothesisConfidence;
    createdAt: string;
    id: string;
    statement: string;
    status: HypothesisStatus;
    updatedAt: string;
  }>;
  id: string;
  preventiveActions?: string;
  project: {
    id: string;
    name: string;
    slug: string;
  };
  resolvedAt?: string;
  rootCause?: string;
  service: {
    environment: string;
    id: string;
    name: string;
    owner?: string;
    slug: string;
  };
  severity: IncidentSeverity;
  sloId?: string;
  sourceAlert?: {
    fingerprint?: string;
    name: string;
    severity?: string;
  };
  status: IncidentStatus;
  summary?: string;
  timeline: Array<{
    createdAt: string;
    description?: string;
    id: string;
    occurredAt: string;
    title: string;
    type: TimelineEventType;
  }>;
  title: string;
  updatedAt: string;
}
