CREATE TABLE IF NOT EXISTS control_plane.slo_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES control_plane.projects(id) ON DELETE CASCADE,
  service_id uuid NOT NULL,
  slug text NOT NULL,
  name text NOT NULL,
  description text,
  window_days integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (service_id, project_id)
    REFERENCES control_plane.services(id, project_id)
    ON DELETE CASCADE,
  CONSTRAINT slo_definitions_slug_format CHECK (slug ~ '^[a-z0-9][a-z0-9_-]{1,62}[a-z0-9]$'),
  CONSTRAINT slo_definitions_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT slo_definitions_window_days_range CHECK (window_days BETWEEN 1 AND 90),
  UNIQUE (id, service_id),
  UNIQUE (service_id, slug)
);

CREATE TABLE IF NOT EXISTS control_plane.sli_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slo_id uuid NOT NULL REFERENCES control_plane.slo_definitions(id) ON DELETE CASCADE,
  service_id uuid NOT NULL,
  indicator_type text NOT NULL,
  target_percentage numeric(6,3) NOT NULL,
  latency_threshold_ms integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (slo_id, service_id)
    REFERENCES control_plane.slo_definitions(id, service_id)
    ON DELETE CASCADE,
  CONSTRAINT sli_definitions_indicator_type CHECK (indicator_type IN ('availability', 'latency')),
  CONSTRAINT sli_definitions_target_percentage_range CHECK (
    target_percentage > 0 AND target_percentage < 100
  ),
  CONSTRAINT sli_definitions_latency_threshold CHECK (
    (indicator_type = 'latency' AND latency_threshold_ms IS NOT NULL AND latency_threshold_ms > 0)
    OR (indicator_type = 'availability' AND latency_threshold_ms IS NULL)
  ),
  UNIQUE (slo_id, indicator_type)
);

CREATE TABLE IF NOT EXISTS control_plane.sli_evaluation_windows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slo_id uuid NOT NULL REFERENCES control_plane.slo_definitions(id) ON DELETE CASCADE,
  sli_id uuid NOT NULL REFERENCES control_plane.sli_definitions(id) ON DELETE CASCADE,
  window_started_at timestamptz NOT NULL,
  window_ended_at timestamptz NOT NULL,
  total_events bigint NOT NULL,
  good_events bigint NOT NULL,
  bad_events bigint GENERATED ALWAYS AS (total_events - good_events) STORED,
  target_percentage_snapshot numeric(6,3) NOT NULL,
  observed_percentage numeric(8,5),
  error_budget_total_events numeric(14,3),
  error_budget_consumed_percentage numeric(8,3),
  error_budget_remaining_percentage numeric(8,3),
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sli_evaluation_windows_time_order CHECK (window_ended_at > window_started_at),
  CONSTRAINT sli_evaluation_windows_event_counts CHECK (
    total_events >= 0 AND good_events >= 0 AND good_events <= total_events
  ),
  CONSTRAINT sli_evaluation_windows_status CHECK (status IN ('ok', 'breached', 'no_data')),
  UNIQUE (sli_id, window_started_at, window_ended_at)
);

CREATE INDEX IF NOT EXISTS idx_slo_definitions_service_id
  ON control_plane.slo_definitions (service_id);

CREATE INDEX IF NOT EXISTS idx_sli_definitions_slo_id
  ON control_plane.sli_definitions (slo_id);

CREATE INDEX IF NOT EXISTS idx_sli_evaluation_windows_slo_window
  ON control_plane.sli_evaluation_windows (slo_id, window_ended_at DESC);

COMMENT ON TABLE control_plane.slo_definitions IS
  'Service-level objectives configured for observed services';

COMMENT ON TABLE control_plane.sli_definitions IS
  'User-visible service-level indicators that compose an SLO';

COMMENT ON TABLE control_plane.sli_evaluation_windows IS
  'Calculated SLI windows with error budget state snapshots';
