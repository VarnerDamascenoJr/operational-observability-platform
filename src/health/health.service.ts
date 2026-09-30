import type { SqlExecutor } from '../database/postgres.js';
import type { PostgresHealth, PostgresHealthRow } from './health.types.js';

export async function checkPostgres(database: SqlExecutor | undefined): Promise<PostgresHealth> {
  if (!database) {
    return {
      status: 'not_configured',
    };
  }

  const startedAt = process.hrtime.bigint();

  try {
    const result = await database.query<PostgresHealthRow>(`
      SELECT
        current_database() AS database_name,
        EXISTS (
          SELECT 1
          FROM information_schema.schemata
          WHERE schema_name = 'control_plane'
        ) AS control_plane_schema_ready,
        (
          SELECT COUNT(*)::int
          FROM information_schema.tables
          WHERE table_schema = 'control_plane'
            AND table_name IN ('projects', 'services', 'operational_configurations')
        ) = 3 AS core_tables_ready,
        (
          SELECT COUNT(*)::int
          FROM public.schema_migrations
        ) AS migrations_applied
    `);
    const latencyMilliseconds = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    const row = result.rows[0];

    if (!row) {
      return {
        status: 'error',
        error: 'PostgreSQL health query returned no rows',
        latencyMilliseconds,
      };
    }

    if (!row.control_plane_schema_ready || !row.core_tables_ready) {
      return {
        status: 'error',
        controlPlaneSchemaReady: row.control_plane_schema_ready,
        coreTablesReady: row.core_tables_ready,
        database: row.database_name,
        error: 'PostgreSQL schema is not ready',
        latencyMilliseconds,
        migrationsApplied: row.migrations_applied,
      };
    }

    return {
      status: 'ok',
      controlPlaneSchemaReady: true,
      coreTablesReady: true,
      database: row.database_name,
      latencyMilliseconds,
      migrationsApplied: row.migrations_applied,
    };
  } catch {
    return {
      status: 'error',
      error: 'PostgreSQL health query failed',
    };
  }
}
