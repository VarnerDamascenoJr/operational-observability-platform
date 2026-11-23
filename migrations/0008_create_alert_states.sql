CREATE TABLE control_plane.alert_states (
  fingerprint text PRIMARY KEY,
  status text NOT NULL CHECK (status IN ('firing', 'resolved')),
  labels jsonb NOT NULL,
  annotations jsonb NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX alert_states_status_updated_idx ON control_plane.alert_states (status, updated_at DESC);
