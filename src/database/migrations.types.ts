import type { QueryResultRow } from 'pg';

export interface AppliedMigration extends QueryResultRow {
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
