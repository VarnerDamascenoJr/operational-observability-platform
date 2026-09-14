import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';

import { buildApp } from './app.js';
import { loadDatabaseConfig } from './config/database.js';
import { runMigrations } from './database/migrations.js';
import { PostgresDatabase } from './database/postgres.js';

if (existsSync('.env')) {
  loadEnvFile('.env');
}

const database = new PostgresDatabase(loadDatabaseConfig());
const app = buildApp({
  closeDatabase: () => database.close(),
  database,
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
