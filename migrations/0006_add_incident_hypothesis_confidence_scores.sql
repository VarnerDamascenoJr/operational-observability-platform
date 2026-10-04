ALTER TABLE control_plane.incident_hypotheses
  ADD COLUMN confidence_score numeric(5,4);

UPDATE control_plane.incident_hypotheses
SET confidence_score = CASE confidence
  WHEN 'low' THEN 0.2500
  WHEN 'medium' THEN 0.5000
  WHEN 'high' THEN 0.7500
  ELSE 0.5000
END
WHERE confidence_score IS NULL;

ALTER TABLE control_plane.incident_hypotheses
  ALTER COLUMN confidence_score SET NOT NULL,
  ADD CONSTRAINT incident_hypotheses_confidence_score
    CHECK (confidence_score >= 0 AND confidence_score <= 1);

CREATE TABLE IF NOT EXISTS control_plane.incident_hypothesis_confidence_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id uuid NOT NULL REFERENCES control_plane.incidents(id) ON DELETE CASCADE,
  hypothesis_id uuid NOT NULL REFERENCES control_plane.incident_hypotheses(id) ON DELETE CASCADE,
  evidence_id uuid REFERENCES control_plane.incident_evidences(id) ON DELETE SET NULL,
  previous_score numeric(5,4) NOT NULL,
  score_delta numeric(5,4) NOT NULL,
  next_score numeric(5,4) NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT incident_hypothesis_confidence_events_reason_not_blank CHECK (btrim(reason) <> ''),
  CONSTRAINT incident_hypothesis_confidence_events_previous_score CHECK (
    previous_score >= 0 AND previous_score <= 1
  ),
  CONSTRAINT incident_hypothesis_confidence_events_delta CHECK (
    score_delta >= -1 AND score_delta <= 1
  ),
  CONSTRAINT incident_hypothesis_confidence_events_next_score CHECK (
    next_score >= 0 AND next_score <= 1
  )
);

CREATE INDEX IF NOT EXISTS idx_incident_hypothesis_confidence_events_incident_id
  ON control_plane.incident_hypothesis_confidence_events (incident_id, created_at);

CREATE INDEX IF NOT EXISTS idx_incident_hypothesis_confidence_events_hypothesis_id
  ON control_plane.incident_hypothesis_confidence_events (hypothesis_id, created_at);

COMMENT ON COLUMN control_plane.incident_hypotheses.confidence_score IS
  'Numeric confidence score from 0 to 1 used to rank incident hypotheses';

COMMENT ON TABLE control_plane.incident_hypothesis_confidence_events IS
  'Auditable history of evidence-driven confidence updates for incident hypotheses';
