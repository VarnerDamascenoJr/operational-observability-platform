import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { QueryResultRow } from 'pg';

import type { ConnectionProvider } from './postgres.js';

const migrationFilePattern = /^(?<version>\d{4})_(?<name>[a-z0-9_]+)\.sql$/;
const migrationLockId = 7_418_202_501;

interface AppliedMigration extends QueryResultRow {
  version: string;
  name: string;
  checksum: string;
}

export interface Migration {
  version: string;
  name: string;
  checksum: string;
  statement: string;
}

function checksum(statement: string): string {
  return createHash('sha256').update(statement).digest('hex');
}

export async function loadMigrations(directory: string): Promise<Migration[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const migrationFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
    .map((entry) => {
      const match = migrationFilePattern.exec(entry.name);

      if (!match?.groups) {
        throw new Error(`Invalid migration filename: ${entry.name}`);
      }

      return {
        filename: entry.name,
        version: match.groups.version,
        name: match.groups.name,
      };
    })
    .sort((left, right) => left.version.localeCompare(right.version));

  const duplicateVersion = migrationFiles.find(
    (migration, index) => migration.version === migrationFiles[index - 1]?.version,
  );

  if (duplicateVersion) {
    throw new Error(`Duplicate migration version: ${duplicateVersion.version}`);
  }

  return Promise.all(
    migrationFiles.map(async (migration) => {
      const statement = await readFile(join(directory, migration.filename), 'utf8');

      return {
        version: migration.version,
        name: migration.name,
        checksum: checksum(statement),
        statement,
      };
    }),
  );
}

export async function runMigrations(
  database: ConnectionProvider,
  directory: string,
): Promise<Migration[]> {
  const migrations = await loadMigrations(directory);

  return database.withConnection(async (connection) => {
    await connection.query('SELECT pg_advisory_lock($1::bigint)', [migrationLockId]);

    try {
      await connection.query(`
        CREATE TABLE IF NOT EXISTS public.schema_migrations (
          version text PRIMARY KEY,
          name text NOT NULL,
          checksum text NOT NULL,
          applied_at timestamptz NOT NULL DEFAULT now()
        )
      `);

      const appliedResult = await connection.query<AppliedMigration>(`
        SELECT version, name, checksum
        FROM public.schema_migrations
        ORDER BY version
      `);
      const appliedByVersion = new Map(
        appliedResult.rows.map((migration) => [migration.version, migration]),
      );
      const pending: Migration[] = [];

      for (const migration of migrations) {
        const applied = appliedByVersion.get(migration.version);

        if (applied) {
          if (applied.name !== migration.name || applied.checksum !== migration.checksum) {
            throw new Error(
              `Applied migration ${migration.version} no longer matches its SQL file`,
            );
          }

          continue;
        }

        await connection.transaction(async (transaction) => {
          await transaction.query(migration.statement);
          await transaction.query(
            `INSERT INTO public.schema_migrations (version, name, checksum)
             VALUES ($1, $2, $3)`,
            [migration.version, migration.name, migration.checksum],
          );
        });
        pending.push(migration);
      }

      return pending;
    } finally {
      await connection.query('SELECT pg_advisory_unlock($1::bigint)', [migrationLockId]);
    }
  });
}
