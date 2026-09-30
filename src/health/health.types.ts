import type { QueryResultRow } from 'pg';

export interface PostgresHealthRow extends QueryResultRow {
  control_plane_schema_ready: boolean;
  core_tables_ready: boolean;
  database_name: string;
  migrations_applied: number;
}

export type PostgresHealth =
  | {
      status: 'ok';
      controlPlaneSchemaReady: true;
      coreTablesReady: true;
      database: string;
      latencyMilliseconds: number;
      migrationsApplied: number;
    }
  | {
      status: 'error';
      controlPlaneSchemaReady?: boolean;
      coreTablesReady?: boolean;
      database?: string;
      error: string;
      latencyMilliseconds?: number;
      migrationsApplied?: number;
    }
  | {
      status: 'not_configured';
    };

export interface HealthResponse {
  services: {
    api: {
      status: 'ok';
    };
    postgres: PostgresHealth;
  };
  status: 'degraded' | 'ok';
}
