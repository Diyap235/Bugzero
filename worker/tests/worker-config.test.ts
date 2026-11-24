import assert from 'node:assert/strict';
import test from 'node:test';

import { getWorkerStartupFailureDetails, parseWorkerArguments, startWorker } from '../src/worker.js';

test('worker arguments accept only a single valid job scope', () => {
  const jobId = '33333333-3333-4333-8333-333333333333';
  const organizationId = '11111111-1111-4111-8111-111111111111';
  assert.equal(parseWorkerArguments([]), undefined);
  assert.deepEqual(
    parseWorkerArguments(['--job-id', jobId, '--organization-id', organizationId]),
    { jobId, organizationId },
  );
  assert.throws(() => parseWorkerArguments(['--job-id', jobId]), /Usage:/);
  assert.throws(
    () => parseWorkerArguments(['--job-id', jobId, '--organization-id', 'not-a-uuid']),
    /organization-id.*valid UUID/,
  );
  assert.throws(() => parseWorkerArguments(['--job-id', 'not-a-uuid']), /Usage:/);
  assert.throws(
    () => parseWorkerArguments(['--job-id', 'not-a-uuid', '--organization-id', organizationId]),
    /job-id.*valid UUID/,
  );
  assert.throws(() => parseWorkerArguments(['--job-id', jobId, '--other']), /Usage:/);
});

test('worker startup failures report safe role and database diagnostics', () => {
  assert.deepEqual(
    getWorkerStartupFailureDetails(new Error(
      'Queue worker must connect as the non-BYPASSRLS bugzero_queue_worker database role',
    )),
    { errorName: 'Error', failureCategory: 'queue_role_validation' },
  );
  assert.deepEqual(
    getWorkerStartupFailureDetails(Object.assign(new Error('database connection failed'), { code: '28P01' })),
    { errorName: 'Error', failureCategory: 'database_error', databaseErrorCode: '28P01' },
  );
  assert.deepEqual(
    getWorkerStartupFailureDetails(Object.assign(new Error('unsafe message'), { code: 'bad code with details' })),
    { errorName: 'Error', failureCategory: 'startup_error' },
  );
});

test('worker startup requires a separate dedicated queue database URL', () => {
  const previousDatabaseUrl = process.env.DATABASE_URL;
  const previousQueueUrl = process.env.DATABASE_QUEUE_URL;
  try {
    process.env.DATABASE_URL = 'postgresql://worker:fixture@ep-test.us-east-2.aws.neon.tech/neondb';
    delete process.env.DATABASE_QUEUE_URL;
    assert.throws(
      () => startWorker(),
      /DATABASE_QUEUE_URL must be configured with a Neon PostgreSQL connection URL/,
    );
  } finally {
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    if (previousQueueUrl === undefined) delete process.env.DATABASE_QUEUE_URL;
    else process.env.DATABASE_QUEUE_URL = previousQueueUrl;
  }
});
