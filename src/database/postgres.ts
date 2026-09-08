import pg, { type PoolClient, type QueryResult, type QueryResultRow } from 'pg';

import type { DatabaseConfig } from '../config/database.js';

const { Pool } = pg;

export interface SqlExecutor {
  query<Row extends QueryResultRow = QueryResultRow>(
    statement: string,
    parameters?: readonly unknown[],
  ): Promise<QueryResult<Row>>;
}

export interface DatabaseConnection extends SqlExecutor {
  transaction<Result>(work: (transaction: SqlExecutor) => Promise<Result>): Promise<Result>;
}

export interface ConnectionProvider {
  withConnection<Result>(
    work: (connection: DatabaseConnection) => Promise<Result>,
  ): Promise<Result>;
}

function createExecutor(client: PoolClient): SqlExecutor {
  return {
    query<Row extends QueryResultRow = QueryResultRow>(
      statement: string,
      parameters: readonly unknown[] = [],
    ) {
      return client.query<Row>(statement, [...parameters]);
    },
  };
}

async function runTransaction<Result>(
  client: PoolClient,
  work: (transaction: SqlExecutor) => Promise<Result>,
): Promise<Result> {
  await client.query('BEGIN');

  try {
    const result = await work(createExecutor(client));
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      throw new AggregateError([error, rollbackError], 'Transaction and rollback both failed');
    }

    throw error;
  }
}

export class PostgresDatabase implements SqlExecutor, ConnectionProvider {
  private readonly pool: pg.Pool;

  constructor(config: DatabaseConfig) {
    this.pool = new Pool({
      connectionString: config.connectionString,
      max: config.maxConnections,
      connectionTimeoutMillis: config.connectionTimeoutMilliseconds,
      idleTimeoutMillis: config.idleTimeoutMilliseconds,
      application_name: 'operational-observability-platform',
    });
  }

  query<Row extends QueryResultRow = QueryResultRow>(
    statement: string,
    parameters: readonly unknown[] = [],
  ): Promise<QueryResult<Row>> {
    return this.pool.query<Row>(statement, [...parameters]);
  }

  async withConnection<Result>(
    work: (connection: DatabaseConnection) => Promise<Result>,
  ): Promise<Result> {
    const client = await this.pool.connect();
    const executor = createExecutor(client);
    const connection: DatabaseConnection = {
      ...executor,
      transaction: (transactionWork) => runTransaction(client, transactionWork),
    };

    try {
      return await work(connection);
    } finally {
      client.release();
    }
  }

  transaction<Result>(work: (transaction: SqlExecutor) => Promise<Result>): Promise<Result> {
    return this.withConnection((connection) => connection.transaction(work));
  }

  close(): Promise<void> {
    return this.pool.end();
  }
}
