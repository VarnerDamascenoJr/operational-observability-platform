import type { QueryResultRow } from 'pg';

export type SliType = 'availability' | 'latency';
export type SliStatus = 'breached' | 'no_data' | 'ok';
export type EvaluationSourceKind = 'fixture' | 'manual' | 'prometheus';
export type BurnRateSeverity = 'no_data' | 'ok' | 'page' | 'warning' | 'watch';

export interface EvaluationSource {
  kind: EvaluationSourceKind;
  period?: string;
  query?: string;
}

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

export interface RollingSliWindow extends SliEvaluationResult {
  endedAt: string;
  source: EvaluationSource;
  startedAt: string;
}

export interface RollingSliSummary {
  averageObservedPercentage: number | null;
  breachedWindows: number;
  evaluatedWindows: number;
  latestStatus: SliStatus;
  latestWindowEndedAt: string | null;
  maxErrorBudgetConsumedPercentage: number | null;
  minObservedPercentage: number | null;
  noDataWindows: number;
  totalBadEvents: number;
  totalEvents: number;
  totalGoodEvents: number;
}

export interface RollingObjectiveResult {
  latencyThresholdMilliseconds?: number;
  summary: RollingSliSummary;
  targetPercentage: number;
  type: SliType;
  windows: RollingSliWindow[];
}

export interface SloRollingWindowsResponse {
  limit: number;
  objectives: RollingObjectiveResult[];
  overallStatus: SliStatus;
  slo: SloDefinition;
}

export interface BurnRateWindowSummary {
  badEvents: number;
  burnRate: number | null;
  endedAt: string | null;
  errorBudgetConsumedPercentage: number | null;
  expectedBudgetConsumedPercentage: number | null;
  goodEvents: number;
  observedPercentage: number | null;
  startedAt: string | null;
  status: SliStatus;
  totalEvents: number;
  windowCount: number;
}

export interface ObjectiveBurnRateResult {
  interpretation: string;
  latencyThresholdMilliseconds?: number;
  longWindow: BurnRateWindowSummary;
  severity: BurnRateSeverity;
  shortWindow: BurnRateWindowSummary;
  targetPercentage: number;
  type: SliType;
}

export interface SloBurnRateResponse {
  longWindowCount: number;
  objectives: ObjectiveBurnRateResult[];
  overallSeverity: BurnRateSeverity;
  shortWindowCount: number;
  slo: SloDefinition;
}

export interface CreateEvaluationInput {
  indicators: Partial<Record<SliType, SliEventCounts>>;
  source: EvaluationSource;
  windowEndedAt: string;
  windowStartedAt: string;
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

export interface SloRow extends QueryResultRow {
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

export interface LatestEvaluationRow extends QueryResultRow {
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

export interface RollingEvaluationRow extends QueryResultRow {
  error_budget_consumed_percentage: string | null;
  error_budget_remaining_percentage: string | null;
  error_budget_total_events: string | null;
  good_events: string | null;
  indicator_type: SliType;
  latency_threshold_ms: number | null;
  observed_percentage: string | null;
  source_kind: EvaluationSourceKind | null;
  source_period: string | null;
  source_query: string | null;
  status: SliStatus | null;
  total_events: string | null;
  window_ended_at: Date | null;
  window_started_at: Date | null;
}

export interface SloMetricRow extends QueryResultRow {
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

export interface SloBurnRateMetricRow extends QueryResultRow {
  environment: string;
  good_events: string | null;
  indicator_type: SliType;
  latency_threshold_ms: number | null;
  service_slug: string;
  slo_slug: string;
  target_percentage: string;
  total_events: string | null;
  window_days: number;
  window_ended_at: Date | null;
  window_started_at: Date | null;
}
