import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { Pool, type PoolClient } from 'pg';

const migrationDirectory = fileURLToPath(new URL('../../../db/migrations/', import.meta.url));
const migrationLockId = 928_304_117;

export interface MigrationFile {
  filename: string;
  sql: string;
  checksum: string;
}

export function removeTransactionEnvelope(sql: string): string {
  const trimmed = sql.trim();
  if (!/^BEGIN;\s*[\s\S]*\sCOMMIT;\s*$/i.test(trimmed)) {
    throw new Error('Migration must contain a BEGIN/COMMIT transaction envelope');
  }
  return trimmed.replace(/^BEGIN;\s*/i, '').replace(/\s*COMMIT;\s*$/i, '');
}

export async function loadMigrations(directory = migrationDirectory): Promise<MigrationFile[]> {
  const filenames = (await readdir(directory))
    .filter((filename) => /^\d{4}_[a-z0-9_]+\.sql$/i.test(filename))
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));

  return Promise.all(filenames.map(async (filename) => {
    const sql = await readFile(path.join(directory, filename), 'utf8');
    const migrationSql = removeTransactionEnvelope(sql);
    return {
      filename,
      sql: migrationSql,
      checksum: createHash('sha256').update(sql).digest('hex'),
    };
  }));
}

async function applyMigrations(client: PoolClient, migrations: MigrationFile[]): Promise<void> {
  await client.query('SELECT pg_advisory_lock($1)', [migrationLockId]);
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS bugzero_schema_migrations (
        filename text PRIMARY KEY,
        checksum text NOT NULL CHECK (checksum ~ '^[a-f0-9]{64}$'),
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    for (const migration of migrations) {
      await client.query('BEGIN');
      try {
        const existing = await client.query<{ checksum: string }>(
          'SELECT checksum FROM bugzero_schema_migrations WHERE filename = $1',
          [migration.filename],
        );
        if (existing.rows[0]) {
          if (existing.rows[0].checksum !== migration.checksum) {
            throw new Error(`Applied migration checksum changed: ${migration.filename}`);
          }
          await client.query('COMMIT');
          continue;
        }

        await client.query(migration.sql);
        await client.query(
          'INSERT INTO bugzero_schema_migrations (filename, checksum) VALUES ($1, $2)',
          [migration.filename, migration.checksum],
        );
        await client.query('COMMIT');
        console.info(`Applied database migration ${migration.filename}`);
      } catch (error) {
        try {
          await client.query('ROLLBACK');
        } catch (rollbackError) {
          throw new AggregateError([error, rollbackError], `Migration transaction failed and rollback did not complete: ${migration.filename}`);
        }
        throw error;
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [migrationLockId]);
  }
}

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) throw new Error('DATABASE_URL must be configured to run migrations');

  const pool = new Pool({ connectionString });
  try {
    const client = await pool.connect();
    try {
      await applyMigrations(client, await loadMigrations());
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  void main().catch((error: unknown) => {
    const errorName = error instanceof Error ? error.name : 'UnknownError';
    console.error(`BugZero database migrations failed (${errorName})`);
    process.exitCode = 1;
  });
}
