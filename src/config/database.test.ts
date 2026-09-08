import { describe, expect, it } from 'vitest';

import { loadDatabaseConfig } from './database.js';

describe('database configuration', () => {
  it('loads a PostgreSQL connection URL', () => {
    expect(
      loadDatabaseConfig({
        DATABASE_URL: 'postgresql://observability:secret@localhost:5432/observability',
      }),
    ).toEqual({
      connectionString: 'postgresql://observability:secret@localhost:5432/observability',
      maxConnections: 10,
      connectionTimeoutMilliseconds: 5_000,
      idleTimeoutMilliseconds: 30_000,
    });
  });

  it('rejects a missing connection URL', () => {
    expect(() => loadDatabaseConfig({})).toThrow('DATABASE_URL is required');
  });

  it('rejects a connection URL for another protocol', () => {
    expect(() => loadDatabaseConfig({ DATABASE_URL: 'https://localhost/database' })).toThrow(
      'DATABASE_URL must use the postgres or postgresql protocol',
    );
  });
});
