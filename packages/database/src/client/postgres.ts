import { Pool, type PoolClient } from 'pg';

import type { DatabasePoolConfig } from '../types/database.js';
import { enforceTenantScopedQueries } from './tenant-context.js';

const globalWithDatabasePool = globalThis as typeof globalThis & {
  __bugzero_database_pool?: Pool;
};

export function createDatabasePool(config: DatabasePoolConfig = {}): Pool {
  const connectionString = config.connectionString ?? process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/bugzero';
  const max = config.max ?? Number(process.env.DATABASE_POOL_MAX ?? '10');
  const idleTimeoutMillis = config.idleTimeoutMillis ?? Number(process.env.DATABASE_IDLE_TIMEOUT_MS ?? '30000');
  const connectionTimeoutMillis = config.connectionTimeoutMillis ?? Number(process.env.DATABASE_CONNECTION_TIMEOUT_MS ?? '5000');

  return enforceTenantScopedQueries(new Pool({
    connectionString,
    max,
    idleTimeoutMillis,
    connectionTimeoutMillis,
  }));
}

export function getDatabasePool(): Pool {
  if (!globalWithDatabasePool.__bugzero_database_pool) {
    globalWithDatabasePool.__bugzero_database_pool = createDatabasePool();
  }

  return globalWithDatabasePool.__bugzero_database_pool;
}

export async function withDatabaseClient<T>(
  operation: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getDatabasePool().connect();

  try {
    return await operation(client);
  } finally {
    client.release();
  }
}
