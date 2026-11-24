import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createDatabasePool,
  requireNeonDatabaseUrl,
  requireQueueWorkerDatabaseUrl,
  requireQueueWorkerLockDatabaseUrl,
} from '../src/client/postgres.js';

const validNeonUrl = 'postgresql://bugzero_queue_worker:fixture@ep-test.us-east-2.aws.neon.tech/neondb?sslmode=require';
const pooledQueueUrl = 'postgresql://bugzero_queue_worker:fixture@ep-test-pooler.c-2.us-east-2.aws.neon.tech/neondb?sslmode=require';
const directQueueLockUrl = 'postgresql://bugzero_queue_worker:fixture@ep-test.c-2.us-east-2.aws.neon.tech/neondb?sslmode=require';

test('database URL validation accepts Neon PostgreSQL URLs without exposing credentials', () => {
  assert.equal(requireNeonDatabaseUrl('DATABASE_URL', validNeonUrl), validNeonUrl);
  assert.throws(
    () => requireNeonDatabaseUrl('DATABASE_URL', 'postgresql://test:fixture@db.example.invalid:5432/bugzero'),
    (error: unknown) => error instanceof Error
      && error.message.includes('DATABASE_URL')
      && !error.message.includes('secret')
      && !error.message.includes('db.example.invalid'),
  );
});

test('database configuration fails clearly when missing or malformed', () => {
  assert.throws(
    () => createDatabasePool({ connectionString: '' }),
    /DATABASE_URL must be configured with a Neon PostgreSQL connection URL/,
  );
  assert.throws(
    () => requireNeonDatabaseUrl('DATABASE_URL', 'not-a-url'),
    /DATABASE_URL must be a valid Neon PostgreSQL connection URL/,
  );
});

test('queue URL requires the dedicated worker role', () => {
  const previous = process.env.DATABASE_QUEUE_URL;
  try {
    delete process.env.DATABASE_QUEUE_URL;
    assert.throws(
      () => requireQueueWorkerDatabaseUrl(),
      /DATABASE_QUEUE_URL must be configured with a Neon PostgreSQL connection URL/,
    );

    process.env.DATABASE_QUEUE_URL = validNeonUrl.replace('bugzero_queue_worker', 'neondb_owner');
    assert.throws(
      () => requireQueueWorkerDatabaseUrl(),
      /DATABASE_QUEUE_URL must use the dedicated bugzero_queue_worker role/,
    );

    process.env.DATABASE_QUEUE_URL = validNeonUrl;
    assert.equal(requireQueueWorkerDatabaseUrl(), validNeonUrl);
  } finally {
    if (previous === undefined) delete process.env.DATABASE_QUEUE_URL;
    else process.env.DATABASE_QUEUE_URL = previous;
  }
});

test('queue lock URL must be direct and match the pooled endpoint, database, and worker role', () => {
  assert.equal(
    requireQueueWorkerLockDatabaseUrl(pooledQueueUrl, directQueueLockUrl),
    directQueueLockUrl,
  );
  assert.throws(
    () => requireQueueWorkerLockDatabaseUrl(pooledQueueUrl, pooledQueueUrl),
    /DATABASE_QUEUE_LOCK_URL must use a direct, unpooled Neon endpoint/,
  );
  assert.throws(
    () => requireQueueWorkerLockDatabaseUrl(pooledQueueUrl, directQueueLockUrl.replace('/neondb', '/other')),
    /must target the same Neon endpoint, database, and worker role/,
  );
  for (const endpoint of ['ep-other-project', 'ep-other-branch']) {
    assert.throws(
      () => requireQueueWorkerLockDatabaseUrl(
        pooledQueueUrl,
        directQueueLockUrl.replace('ep-test.c-2', `${endpoint}.c-2`),
      ),
      /must target the same Neon endpoint, database, and worker role/,
    );
  }
  assert.throws(
    () => requireQueueWorkerLockDatabaseUrl(
      pooledQueueUrl,
      directQueueLockUrl.replace('bugzero_queue_worker', 'other_role'),
    ),
    /DATABASE_QUEUE_LOCK_URL must use the dedicated bugzero_queue_worker role/,
  );
});

test('queue lock URL rejects missing and malformed values without exposing them', () => {
  const previous = process.env.DATABASE_QUEUE_LOCK_URL;
  try {
    delete process.env.DATABASE_QUEUE_LOCK_URL;
    assert.throws(
      () => requireQueueWorkerLockDatabaseUrl(pooledQueueUrl),
      /DATABASE_QUEUE_LOCK_URL must be configured/,
    );
    assert.throws(
      () => requireQueueWorkerLockDatabaseUrl(pooledQueueUrl, 'postgresql://secret@not-a-neon-host/neondb'),
      (error: unknown) => error instanceof Error
        && error.message.includes('DATABASE_QUEUE_LOCK_URL')
        && !error.message.includes('secret')
        && !error.message.includes('not-a-neon-host'),
    );
  } finally {
    if (previous === undefined) delete process.env.DATABASE_QUEUE_LOCK_URL;
    else process.env.DATABASE_QUEUE_LOCK_URL = previous;
  }
});
