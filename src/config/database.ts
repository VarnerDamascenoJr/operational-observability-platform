export interface DatabaseConfig {
  connectionString: string;
  maxConnections: number;
  connectionTimeoutMilliseconds: number;
  idleTimeoutMilliseconds: number;
}

export function loadDatabaseConfig(env: NodeJS.ProcessEnv = process.env): DatabaseConfig {
  const connectionString = env.DATABASE_URL;

  if (!connectionString) {
    throw new Error('DATABASE_URL is required');
  }

  let databaseUrl: URL;

  try {
    databaseUrl = new URL(connectionString);
  } catch {
    throw new Error('DATABASE_URL must be a valid PostgreSQL URL');
  }

  if (databaseUrl.protocol !== 'postgres:' && databaseUrl.protocol !== 'postgresql:') {
    throw new Error('DATABASE_URL must use the postgres or postgresql protocol');
  }

  return {
    connectionString,
    maxConnections: 10,
    connectionTimeoutMilliseconds: 5_000,
    idleTimeoutMilliseconds: 30_000,
  };
}
