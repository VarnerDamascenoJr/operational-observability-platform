CREATE TABLE IF NOT EXISTS control_plane.incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES control_plane.projects(id) ON DELETE CASCADE,
  service_id uuid NOT NULL,
  slo_id uuid REFERENCES control_plane.slo_definitions(id) ON DELETE SET NULL,
  title text NOT NULL,
  summary text,
  severity text NOT NULL,
  status text NOT NULL DEFAULT 'open',
  source_alert_name text,
  source_alert_fingerprint text,
  source_alert_severity text,
  detected_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  root_cause text,
  preventive_actions text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (service_id, project_id)
    REFERENCES control_plane.services(id, project_id)
    ON DELETE CASCADE,
  CONSTRAINT incidents_title_not_blank CHECK (btrim(title) <> ''),
  CONSTRAINT incidents_severity CHECK (severity IN ('info', 'warning', 'page', 'critical')),
  CONSTRAINT incidents_status CHECK (status IN ('open', 'investigating', 'mitigated', 'resolved')),
  CONSTRAINT incidents_resolved_fields CHECK (
    (status <> 'resolved' AND resolved_at IS NULL)
    OR (
      status = 'resolved'
      AND resolved_at IS NOT NULL
      AND btrim(coalesce(root_cause, '')) <> ''
      AND btrim(coalesce(preventive_actions, '')) <> ''
    )
  )
);

CREATE TABLE IF NOT EXISTS control_plane.incident_evidences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id uuid NOT NULL REFERENCES control_plane.incidents(id) ON DELETE CASCADE,
  evidence_type text NOT NULL,
  title text NOT NULL,
  url text,
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT incident_evidences_type CHECK (
    evidence_type IN ('alert', 'dashboard', 'trace', 'log', 'runbook', 'note')
  ),
  CONSTRAINT incident_evidences_title_not_blank CHECK (btrim(title) <> '')
);

CREATE TABLE IF NOT EXISTS control_plane.incident_hypotheses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id uuid NOT NULL REFERENCES control_plane.incidents(id) ON DELETE CASCADE,
  statement text NOT NULL,
  confidence text NOT NULL,
  status text NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT incident_hypotheses_statement_not_blank CHECK (btrim(statement) <> ''),
  CONSTRAINT incident_hypotheses_confidence CHECK (confidence IN ('low', 'medium', 'high')),
  CONSTRAINT incident_hypotheses_status CHECK (status IN ('open', 'supported', 'rejected'))
);

CREATE TABLE IF NOT EXISTS control_plane.incident_timeline_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id uuid NOT NULL REFERENCES control_plane.incidents(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  title text NOT NULL,
  description text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT incident_timeline_events_type CHECK (
    event_type IN ('opened', 'status_changed', 'evidence_added', 'hypothesis_added', 'note', 'resolved')
  ),
  CONSTRAINT incident_timeline_events_title_not_blank CHECK (btrim(title) <> '')
);

CREATE INDEX IF NOT EXISTS idx_incidents_service_status
  ON control_plane.incidents (service_id, status, detected_at DESC);

CREATE INDEX IF NOT EXISTS idx_incidents_slo_id
  ON control_plane.incidents (slo_id)
  WHERE slo_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_incident_evidences_incident_id
  ON control_plane.incident_evidences (incident_id, created_at);

CREATE INDEX IF NOT EXISTS idx_incident_hypotheses_incident_id
  ON control_plane.incident_hypotheses (incident_id, created_at);

CREATE INDEX IF NOT EXISTS idx_incident_timeline_incident_id
  ON control_plane.incident_timeline_events (incident_id, occurred_at);

COMMENT ON TABLE control_plane.incidents IS
  'Incidents opened from symptom alerts and investigated inside the observability control plane';

COMMENT ON TABLE control_plane.incident_evidences IS
  'Links and notes that preserve alert, dashboard, trace, log and runbook evidence for an incident';

COMMENT ON TABLE control_plane.incident_hypotheses IS
  'Investigation hypotheses considered while responding to an incident';

COMMENT ON TABLE control_plane.incident_timeline_events IS
  'Ordered operational decisions and observations captured during an incident';
