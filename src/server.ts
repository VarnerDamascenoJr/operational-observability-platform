import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';

import { buildApp } from './app.js';
import { loadDatabaseConfig } from './config/database.js';
import { loadServiceIdentity } from './config/service.js';
import { runMigrations } from './database/migrations.js';
import { PostgresDatabase } from './database/postgres.js';
import { createTelemetryExporterFromEnv } from './observability/otlp.js';

if (existsSync('.env')) {
  loadEnvFile('.env');
}

// The pool does not connect until after app has been constructed.
const database = new PostgresDatabase(loadDatabaseConfig(), (error) => {
  const code = 'code' in error && typeof error.code === 'string' ? error.code : undefined;
  app.log.warn(
    { error_code: code && /^[A-Z0-9]{5}$/.test(code) ? code : undefined },
    'PostgreSQL idle connection failed',
  );
});
const identity = loadServiceIdentity();
const app = buildApp({
  closeDatabase: () => database.close(),
  database,
  identity,
  telemetry: createTelemetryExporterFromEnv(process.env, identity),
});
const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '0.0.0.0';
const migrationsDirectory = fileURLToPath(new URL('../migrations/', import.meta.url));

try {
  const appliedMigrations = await runMigrations(database, migrationsDirectory);

  for (const migration of appliedMigrations) {
    app.log.info(
      {
        migration_name: migration.name,
        migration_version: migration.version,
      },
      'database migration applied',
    );
  }

  await app.listen({ host, port });
} catch (error) {
  app.log.error(error);
  await database.close();
  process.exit(1);
}
