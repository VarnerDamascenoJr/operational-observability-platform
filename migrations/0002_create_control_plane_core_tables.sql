CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS control_plane.projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT projects_slug_format CHECK (slug ~ '^[a-z0-9][a-z0-9_-]{1,62}[a-z0-9]$'),
  CONSTRAINT projects_name_not_blank CHECK (btrim(name) <> '')
);

CREATE TABLE IF NOT EXISTS control_plane.services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES control_plane.projects(id) ON DELETE CASCADE,
  slug text NOT NULL,
  name text NOT NULL,
  owner text,
  environment text NOT NULL DEFAULT 'development',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT services_slug_format CHECK (slug ~ '^[a-z0-9][a-z0-9_-]{1,62}[a-z0-9]$'),
  CONSTRAINT services_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT services_environment_not_blank CHECK (btrim(environment) <> ''),
  UNIQUE (id, project_id),
  UNIQUE (project_id, slug)
);

CREATE TABLE IF NOT EXISTS control_plane.operational_configurations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES control_plane.projects(id) ON DELETE CASCADE,
  service_id uuid,
  config_key text NOT NULL,
  config_value jsonb NOT NULL,
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (service_id, project_id)
    REFERENCES control_plane.services(id, project_id)
    ON DELETE CASCADE,
  CONSTRAINT operational_configurations_key_format CHECK (
    config_key ~ '^[a-z][a-z0-9_.-]{1,126}[a-z0-9]$'
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_operational_configurations_project_key
  ON control_plane.operational_configurations (project_id, config_key)
  WHERE service_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_operational_configurations_service_key
  ON control_plane.operational_configurations (project_id, service_id, config_key)
  WHERE service_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_services_project_id
  ON control_plane.services (project_id);

CREATE INDEX IF NOT EXISTS idx_operational_configurations_project_id
  ON control_plane.operational_configurations (project_id);

COMMENT ON TABLE control_plane.projects IS
  'Portfolio or product boundaries managed by the observability control plane';

COMMENT ON TABLE control_plane.services IS
  'Services observed inside a project and environment';

COMMENT ON TABLE control_plane.operational_configurations IS
  'JSON operational settings scoped to a project or service';
