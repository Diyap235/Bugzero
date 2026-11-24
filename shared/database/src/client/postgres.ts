import { Pool, type PoolClient } from 'pg';

import type { DatabasePoolConfig } from '../types/database.js';
import { enforceTenantScopedQueries } from './tenant-context.js';

const globalWithDatabasePool = globalThis as typeof globalThis & {
  __bugzero_database_pool?: Pool;
  __bugzero_database_pool_proxy?: Pool;
  __bugzero_queue_database_pool?: Pool;
};

export function requireNeonDatabaseUrl(
  variableName: 'DATABASE_URL' | 'DATABASE_URL_UNPOOLED' | 'DATABASE_QUEUE_URL' | 'DATABASE_QUEUE_LOCK_URL',
  value = process.env[variableName],
): string {
  const connectionString = value?.trim();
  if (!connectionString) {
    throw new Error(`${variableName} must be configured with a Neon PostgreSQL connection URL`);
  }

  let parsed: URL;
  try {
    parsed = new URL(connectionString);
  } catch {
    throw new Error(`${variableName} must be a valid Neon PostgreSQL connection URL`);
  }

  if (
    !['postgres:', 'postgresql:'].includes(parsed.protocol)
    || !parsed.hostname.toLowerCase().endsWith('.neon.tech')
    || parsed.pathname.length < 2
  ) {
    throw new Error(`${variableName} must be a valid Neon PostgreSQL connection URL`);
  }

  return connectionString;
}

function getUrlUsername(url: URL, variableName: string): string {
  let username: string;
  try {
    username = decodeURIComponent(url.username);
  } catch {
    throw new Error(`${variableName} must use the dedicated bugzero_queue_worker role`);
  }
  if (username !== 'bugzero_queue_worker') {
    throw new Error(`${variableName} must use the dedicated bugzero_queue_worker role`);
  }

  return username;
}

export function requireQueueWorkerDatabaseUrl(value?: string): string {
  const connectionString = requireNeonDatabaseUrl('DATABASE_QUEUE_URL', value);
  getUrlUsername(new URL(connectionString), 'DATABASE_QUEUE_URL');
  return connectionString;
}

function normalizedNeonEndpoint(hostname: string): string {
  return hostname.replace(/^([^.]+)-pooler\./i, '$1.').toLowerCase();
}

function isNeonPoolerEndpoint(hostname: string): boolean {
  return /^[^.]+-pooler\./i.test(hostname);
}

function getDatabaseName(url: URL, variableName: string): string {
  try {
    const databaseName = decodeURIComponent(url.pathname.slice(1));
    if (databaseName) return databaseName;
  } catch {
    // Report the same sanitized validation error for malformed database names.
  }
  throw new Error(`${variableName} must identify the same Neon database as DATABASE_QUEUE_URL`);
}

export function requireQueueWorkerLockDatabaseUrl(
  queueValue?: string,
  lockValue = process.env.DATABASE_QUEUE_LOCK_URL,
): string {
  const queueConnectionString = requireQueueWorkerDatabaseUrl(queueValue);
  const lockConnectionString = requireNeonDatabaseUrl('DATABASE_QUEUE_LOCK_URL', lockValue);
  const queueUrl = new URL(queueConnectionString);
  const lockUrl = new URL(lockConnectionString);

  getUrlUsername(lockUrl, 'DATABASE_QUEUE_LOCK_URL');
  if (isNeonPoolerEndpoint(lockUrl.hostname)) {
    throw new Error('DATABASE_QUEUE_LOCK_URL must use a direct, unpooled Neon endpoint');
  }

  const sameEndpoint = normalizedNeonEndpoint(queueUrl.hostname) === normalizedNeonEndpoint(lockUrl.hostname);
  const sameDatabase = getDatabaseName(queueUrl, 'DATABASE_QUEUE_URL')
    === getDatabaseName(lockUrl, 'DATABASE_QUEUE_LOCK_URL');
  const sameRole = getUrlUsername(queueUrl, 'DATABASE_QUEUE_URL')
    === getUrlUsername(lockUrl, 'DATABASE_QUEUE_LOCK_URL');
  const samePort = (queueUrl.port || '5432') === (lockUrl.port || '5432');
  if (!sameEndpoint || !sameDatabase || !sameRole || !samePort) {
    throw new Error('DATABASE_QUEUE_LOCK_URL must target the same Neon endpoint, database, and worker role as DATABASE_QUEUE_URL');
  }

  return lockConnectionString;
}

export function createDatabasePool(config: DatabasePoolConfig = {}): Pool {
  const connectionString = requireNeonDatabaseUrl('DATABASE_URL', config.connectionString ?? process.env.DATABASE_URL);
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

function createLazyDatabasePool(resolvePool: () => Pool): Pool {
  const target = Object.create(null) as Pool;
  return new Proxy(target, {
    get(_target, property) {
      const pool = resolvePool();
      const member: unknown = Reflect.get(pool, property, pool);
      return typeof member === 'function' ? member.bind(pool) : member;
    },
    set(_target, property, value) {
      return Reflect.set(resolvePool(), property, value);
    },
  });
}

export function getDatabasePool(): Pool {
  if (!globalWithDatabasePool.__bugzero_database_pool_proxy) {
    globalWithDatabasePool.__bugzero_database_pool_proxy = createLazyDatabasePool(() => {
      globalWithDatabasePool.__bugzero_database_pool ??= createDatabasePool();
      return globalWithDatabasePool.__bugzero_database_pool;
    });
  }

  return globalWithDatabasePool.__bugzero_database_pool_proxy;
}

export function getQueueDatabasePool(): Pool {
  if (!globalWithDatabasePool.__bugzero_queue_database_pool) {
    const connectionString = requireQueueWorkerDatabaseUrl();
    globalWithDatabasePool.__bugzero_queue_database_pool = new Pool({
      connectionString,
      max: Number(process.env.DATABASE_QUEUE_POOL_MAX ?? '2'),
      idleTimeoutMillis: Number(process.env.DATABASE_IDLE_TIMEOUT_MS ?? '30000'),
      connectionTimeoutMillis: Number(process.env.DATABASE_CONNECTION_TIMEOUT_MS ?? '5000'),
    });
  }

  return globalWithDatabasePool.__bugzero_queue_database_pool;
}

export async function closeDatabasePool(): Promise<void> {
  const pool = globalWithDatabasePool.__bugzero_database_pool;
  if (!pool) return;
  delete globalWithDatabasePool.__bugzero_database_pool;
  await pool.end();
}

export async function closeQueueDatabasePool(): Promise<void> {
  const pool = globalWithDatabasePool.__bugzero_queue_database_pool;
  if (!pool) return;
  delete globalWithDatabasePool.__bugzero_queue_database_pool;
  await pool.end();
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
