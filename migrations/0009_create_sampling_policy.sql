CREATE TABLE control_plane.sampling_policy (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  latency_threshold_ms integer NOT NULL CHECK (latency_threshold_ms BETWEEN 1 AND 3600000),
  healthy_sampling_percentage integer NOT NULL CHECK (healthy_sampling_percentage BETWEEN 0 AND 100),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO control_plane.sampling_policy
  (singleton, latency_threshold_ms, healthy_sampling_percentage)
VALUES (true, 500, 10);
