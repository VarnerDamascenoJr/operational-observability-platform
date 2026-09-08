import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';

import { loadDatabaseConfig } from '../config/database.js';
import { runMigrations } from './migrations.js';
import { PostgresDatabase } from './postgres.js';

async function migrate(): Promise<void> {
  if (existsSync('.env')) {
    loadEnvFile('.env');
  }

  const database = new PostgresDatabase(loadDatabaseConfig());
  const migrationsDirectory = fileURLToPath(new URL('../../migrations/', import.meta.url));

  try {
    const applied = await runMigrations(database, migrationsDirectory);

    if (applied.length === 0) {
      console.log('Database is up to date');
      return;
    }

    for (const migration of applied) {
      console.log(`Applied migration ${migration.version}_${migration.name}`);
    }
  } finally {
    await database.close();
  }
}

migrate().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Database migration failed');
  process.exitCode = 1;
});
