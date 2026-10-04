import type { QueryResultRow } from 'pg';

import type { PaginationInput, PaginationResponse } from '../common/pagination/pagination.types.js';

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

export interface HypothesisConfidenceAdjustmentInput {
  evidenceId?: string;
  reason: string;
  scoreDelta: number;
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

export interface IncidentListCursor {
  createdAt: string;
  detectedAt: string;
  id: string;
}

export type IncidentListInput = PaginationInput<IncidentListCursor>;

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
  created_at_cursor: string;
  detected_at: Date;
  detected_at_cursor: string;
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
  incident_id: string;
  title: string;
  url: string | null;
}

export interface HypothesisRow extends QueryResultRow {
  confidence: HypothesisConfidence;
  confidence_score: string;
  created_at: Date;
  id: string;
  incident_id: string;
  statement: string;
  status: HypothesisStatus;
  updated_at: Date;
}

export interface HypothesisConfidenceEventRow extends QueryResultRow {
  created_at: Date;
  evidence_id: string | null;
  evidence_title: string | null;
  hypothesis_id: string;
  id: string;
  incident_id: string;
  next_score: string;
  previous_score: string;
  reason: string;
  score_delta: string;
}

export interface TimelineRow extends QueryResultRow {
  created_at: Date;
  description: string | null;
  event_type: TimelineEventType;
  id: string;
  incident_id: string;
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
    confidenceHistory: Array<{
      createdAt: string;
      evidence?: {
        id: string;
        title: string;
      };
      id: string;
      nextScore: number;
      previousScore: number;
      reason: string;
      scoreDelta: number;
    }>;
    confidenceScore: number;
    createdAt: string;
    id: string;
    statement: string;
    status: HypothesisStatus;
    updatedAt: string;
  }>;
  hypothesisSummary: HypothesisConfidenceSummary;
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

export interface IncidentListResponse extends PaginationResponse {
  incidents: IncidentResponse[];
}

export interface HypothesisConfidenceSummary {
  mostLikelyHypothesis: {
    confidence: HypothesisConfidence;
    confidenceScore: number;
    id: string;
    statement: string;
  } | null;
  remainingUncertainty: number;
}
