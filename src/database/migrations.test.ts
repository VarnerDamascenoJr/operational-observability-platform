import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { loadMigrations } from './migrations.js';

const temporaryDirectories: string[] = [];

async function createMigrationDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'observability-migrations-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

describe('migration loading', () => {
  it('loads migrations in version order with stable checksums', async () => {
    const directory = await createMigrationDirectory();
    await writeFile(join(directory, '0002_second.sql'), 'SELECT 2;\n');
    await writeFile(join(directory, '0001_first.sql'), 'SELECT 1;\n');

    const migrations = await loadMigrations(directory);

    expect(migrations.map(({ version, name }) => ({ version, name }))).toEqual([
      { version: '0001', name: 'first' },
      { version: '0002', name: 'second' },
    ]);
    expect(migrations[0]?.checksum).toMatch(/^[a-f0-9]{64}$/);
  });

  it('rejects migration filenames outside the convention', async () => {
    const directory = await createMigrationDirectory();
    await writeFile(join(directory, 'initial.sql'), 'SELECT 1;\n');

    await expect(loadMigrations(directory)).rejects.toThrow(
      'Invalid migration filename: initial.sql',
    );
  });

  it('rejects duplicate migration versions', async () => {
    const directory = await createMigrationDirectory();
    await writeFile(join(directory, '0001_first.sql'), 'SELECT 1;\n');
    await writeFile(join(directory, '0001_duplicate.sql'), 'SELECT 2;\n');

    await expect(loadMigrations(directory)).rejects.toThrow('Duplicate migration version: 0001');
  });
});
