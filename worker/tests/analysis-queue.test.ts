import test from 'node:test';
import assert from 'node:assert/strict';
import type { Pool } from 'pg';
import type { AnalysisJob, AnalysisRun, AnalysisRepository } from '@bugzero/database';

import { PostgresAnalysisQueueWorker } from '../src/jobs/analysis-queue.js';

const targetJobId = '33333333-3333-4333-8333-333333333333';
const otherJobId = '44444444-4444-4444-8444-444444444444';
const organizationId = '11111111-1111-4111-8111-111111111111';
const otherOrganizationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const runId = '22222222-2222-4222-8222-222222222222';
const otherRunId = '55555555-5555-4555-8555-555555555555';

function createAnalysisJob(
  id: string,
  jobOrganizationId: string,
  jobRunId: string,
  status: AnalysisJob['status'] = 'RUNNING',
): AnalysisJob {
  return {
    id,
    organization_id: jobOrganizationId,
    run_id: jobRunId,
    stage: 'PARSING',
    analyzer: 'test',
    analyzer_type: 'STRUCTURAL',
    scope_key: 'test',
    status,
    attempt: 1,
    idempotency_key: 'test',
    created_at: new Date(0).toISOString(),
    started_at: new Date(0).toISOString(),
    finished_at: null,
  };
}

function createAnalysisRun(id: string, runOrganizationId: string): AnalysisRun {
  return {
    id,
    organization_id: runOrganizationId,
    repository_id: '66666666-6666-4666-8666-666666666666',
    commit_id: '77777777-7777-4777-8777-777777777777',
    profile_id: 'test',
    profile_version: '1',
    scope: 'COMMIT',
    status: 'RUNNING',
    coverage: {},
    created_at: new Date(0).toISOString(),
    started_at: new Date(0).toISOString(),
    completed_at: null,
  };
}

function createQueueHarness(options: {
  queuedJob?: { id: string; organization_id: string; run_id: string; attempt: number; max_attempts: number };
  expiredJob?: { id: string; organization_id: string; run_id: string };
  persistedJob?: AnalysisJob | null;
  persistedRun?: AnalysisRun | null;
}) {
  const statements: { sql: string; values: unknown[] }[] = [];
  let processorCalls = 0;
  let deadLetterUpdates = 0;
  let acknowledgmentUpdates = 0;
  const client = {
    async query(sql: string, values: unknown[] = []) {
      statements.push({ sql, values });
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes("SET status = 'DEAD_LETTER'")) {
        const matchesScope = options.expiredJob
          && options.expiredJob.id === values[0]
          && options.expiredJob.organization_id === values[1];
        deadLetterUpdates += matchesScope ? 1 : 0;
        return { rows: matchesScope ? [options.expiredJob] : [], rowCount: matchesScope ? 1 : 0 };
      }
      if (sql.includes('WITH candidate AS')) {
        const matchesScope = options.queuedJob
          && options.queuedJob.id === values[2]
          && options.queuedJob.organization_id === values[3];
        if (!matchesScope) return { rows: [], rowCount: 0 };
        return {
          rows: [{
            ...options.queuedJob,
            lease_owner: String(values[0]),
          }],
          rowCount: 1,
        };
      }
      if (sql.includes('SELECT organization_id, id, run_id, status, attempt, max_attempts')) {
        const job = options.queuedJob;
        if (!job) return { rows: [], rowCount: 0 };
        return {
          rows: [{
            ...job,
            status: 'RUNNING',
          }],
          rowCount: 1,
        };
      }
      if (sql.includes('SET status = $4')) {
        acknowledgmentUpdates += 1;
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`Unexpected scoped queue SQL: ${sql}`);
    },
    release() {},
  };
  const pool = {
    async query() {
      return { rows: [{ session_user: 'bugzero_queue_worker', rolbypassrls: false }], rowCount: 1 };
    },
    async connect() { return client; },
  } as unknown as Pool;
  const analysis: Pick<AnalysisRepository, 'getJob' | 'getRun'> = {
    async getJob() {
      return options.persistedJob ?? null;
    },
    async getRun() {
      return options.persistedRun ?? null;
    },
  };

  return {
    pool,
    analysis,
    statements,
    get processorCalls() { return processorCalls; },
    get deadLetterUpdates() { return deadLetterUpdates; },
    get acknowledgmentUpdates() { return acknowledgmentUpdates; },
    processor: async () => { processorCalls += 1; },
  };
}

test('dead-letter finalization failures are retried without claiming another job', async () => {
  const expiredJob = {
    organization_id: '11111111-1111-4111-8111-111111111111',
    run_id: '22222222-2222-4222-8222-222222222222',
    id: '33333333-3333-4333-8333-333333333333',
  };
  let deadLetterTransitions = 0;
  let retrySchedulingUpdates = 0;
  let candidateClaims = 0;
  let finalizationAttempts = 0;
  let worker!: PostgresAnalysisQueueWorker;

  const client = {
    async query(sql: string) {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes("SET status = 'DEAD_LETTER'")) {
        deadLetterTransitions += 1;
        return { rows: deadLetterTransitions <= 2 ? [expiredJob] : [], rowCount: deadLetterTransitions <= 2 ? 1 : 0 };
      }
      if (sql.includes("SET status = 'RUNNING'") && sql.includes('WHERE organization_id = $1 AND id = $2 AND status = \'DEAD_LETTER\'')) {
        retrySchedulingUpdates += 1;
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes('WITH candidate AS')) {
        candidateClaims += 1;
        return { rows: [], rowCount: 0 };
      }
      throw new Error(`Unexpected queue SQL: ${sql}`);
    },
    release() {},
  };
  const pool = {
    async query() {
      return { rows: [{ session_user: 'bugzero_queue_worker', rolbypassrls: false }], rowCount: 1 };
    },
    async connect() { return client; },
  } as unknown as Pool;

  worker = new PostgresAnalysisQueueWorker(
    async () => undefined,
    {
      pollIntervalMs: 1,
      finalizeFailedRun: async () => {
        finalizationAttempts += 1;
        if (finalizationAttempts === 1) throw new Error('temporary run-store failure');
        void worker.close();
      },
    },
    pool,
  );
  await worker.run();

  assert.equal(finalizationAttempts, 2);
  assert.equal(retrySchedulingUpdates, 1);
  assert.equal(deadLetterTransitions, 2);
  assert.equal(candidateClaims, 0);
});

test('single-job mode claims and processes only the requested job in the requested organization', async () => {
  const harness = createQueueHarness({
    queuedJob: { id: targetJobId, organization_id: organizationId, run_id: runId, attempt: 1, max_attempts: 3 },
    persistedJob: createAnalysisJob(targetJobId, organizationId, runId),
    persistedRun: createAnalysisRun(runId, organizationId),
  });
  const worker = new PostgresAnalysisQueueWorker(
    harness.processor,
    { targetJobId, targetOrganizationId: organizationId, pollIntervalMs: 1, leaseDurationMs: 1000 },
    harness.pool,
    harness.analysis,
  );

  await worker.run();

  const expiredSweep = harness.statements.find(({ sql }) => sql.includes("SET status = 'DEAD_LETTER'"));
  const candidateClaim = harness.statements.find(({ sql }) => sql.includes('WITH candidate AS'));
  assert.ok(expiredSweep?.sql.includes('AND ($1::uuid IS NULL OR id = $1::uuid)'));
  assert.ok(expiredSweep?.sql.includes('AND ($2::uuid IS NULL OR organization_id = $2::uuid)'));
  assert.deepEqual(expiredSweep?.values, [targetJobId, organizationId]);
  assert.ok(candidateClaim?.sql.includes('AND ($3::uuid IS NULL OR id = $3::uuid)'));
  assert.ok(candidateClaim?.sql.includes('AND ($4::uuid IS NULL OR organization_id = $4::uuid)'));
  assert.equal(candidateClaim?.values[2], targetJobId);
  assert.equal(candidateClaim?.values[3], organizationId);
  assert.equal(harness.statements.filter(({ sql }) => sql.includes('WITH candidate AS')).length, 1);
  assert.equal(harness.processorCalls, 1);
});

test('single-job mode does not claim a matching job ID from a different organization', async () => {
  const harness = createQueueHarness({
    queuedJob: { id: targetJobId, organization_id: otherOrganizationId, run_id: runId, attempt: 1, max_attempts: 3 },
  });
  const worker = new PostgresAnalysisQueueWorker(
    harness.processor,
    { targetJobId, targetOrganizationId: organizationId, pollIntervalMs: 1, leaseDurationMs: 1000 },
    harness.pool,
    harness.analysis,
  );

  await worker.run();

  assert.equal(harness.processorCalls, 0);
  assert.equal(harness.acknowledgmentUpdates, 0);
});

test('single-job mode does not claim a different job ID', async () => {
  const harness = createQueueHarness({
    queuedJob: { id: otherJobId, organization_id: organizationId, run_id: runId, attempt: 1, max_attempts: 3 },
  });
  const worker = new PostgresAnalysisQueueWorker(
    harness.processor,
    { targetJobId, targetOrganizationId: organizationId, pollIntervalMs: 1, leaseDurationMs: 1000 },
    harness.pool,
    harness.analysis,
  );

  await worker.run();

  assert.equal(harness.processorCalls, 0);
  assert.equal(harness.acknowledgmentUpdates, 0);
});

test('single-job mode rejects a missing or invalid organization ID', () => {
  const harness = createQueueHarness({});
  assert.throws(
    () => new PostgresAnalysisQueueWorker(
      harness.processor,
      { targetJobId },
      harness.pool,
      harness.analysis,
    ),
    /requires both a target job ID and organization ID/,
  );
  assert.throws(
    () => new PostgresAnalysisQueueWorker(
      harness.processor,
      { targetJobId, targetOrganizationId: 'not-a-uuid' },
      harness.pool,
      harness.analysis,
    ),
    /target organization ID must be a valid UUID/,
  );
});

test('expired lease cleanup is scoped to the requested job and organization', async () => {
  const harness = createQueueHarness({
    expiredJob: { id: targetJobId, organization_id: otherOrganizationId, run_id: runId },
  });
  const worker = new PostgresAnalysisQueueWorker(
    harness.processor,
    {
      targetJobId,
      targetOrganizationId: organizationId,
      pollIntervalMs: 1,
      leaseDurationMs: 1000,
      finalizeFailedRun: async () => { throw new Error('an out-of-scope expired job must not be finalized'); },
    },
    harness.pool,
    harness.analysis,
  );

  await worker.run();

  const expiredSweep = harness.statements.find(({ sql }) => sql.includes("SET status = 'DEAD_LETTER'"));
  assert.ok(expiredSweep?.sql.includes('AND ($1::uuid IS NULL OR id = $1::uuid)'));
  assert.ok(expiredSweep?.sql.includes('AND ($2::uuid IS NULL OR organization_id = $2::uuid)'));
  assert.deepEqual(expiredSweep?.values, [targetJobId, organizationId]);
  assert.equal(harness.deadLetterUpdates, 0);
  assert.equal(harness.processorCalls, 0);
});

test('single-job processing is rejected when its persisted job references a different run', async () => {
  const harness = createQueueHarness({
    queuedJob: { id: targetJobId, organization_id: organizationId, run_id: runId, attempt: 1, max_attempts: 3 },
    persistedJob: createAnalysisJob(targetJobId, organizationId, otherRunId),
    persistedRun: createAnalysisRun(runId, organizationId),
  });
  const worker = new PostgresAnalysisQueueWorker(
    harness.processor,
    { targetJobId, targetOrganizationId: organizationId, pollIntervalMs: 1, leaseDurationMs: 1000 },
    harness.pool,
    harness.analysis,
  );

  await worker.run();

  assert.equal(harness.processorCalls, 0);
  assert.equal(harness.acknowledgmentUpdates, 1);
});

test('single-job processing is rejected when its persisted job belongs to a different organization', async () => {
  const harness = createQueueHarness({
    queuedJob: { id: targetJobId, organization_id: organizationId, run_id: runId, attempt: 1, max_attempts: 3 },
    persistedJob: createAnalysisJob(targetJobId, otherOrganizationId, runId),
    persistedRun: createAnalysisRun(runId, organizationId),
  });
  const worker = new PostgresAnalysisQueueWorker(
    harness.processor,
    { targetJobId, targetOrganizationId: organizationId, pollIntervalMs: 1, leaseDurationMs: 1000 },
    harness.pool,
    harness.analysis,
  );

  await worker.run();

  assert.equal(harness.processorCalls, 0);
  assert.equal(harness.acknowledgmentUpdates, 1);
});

test('single-job processing is rejected when its persisted run belongs to a different organization', async () => {
  const harness = createQueueHarness({
    queuedJob: { id: targetJobId, organization_id: organizationId, run_id: runId, attempt: 1, max_attempts: 3 },
    persistedJob: createAnalysisJob(targetJobId, organizationId, runId),
    persistedRun: createAnalysisRun(runId, otherOrganizationId),
  });
  const worker = new PostgresAnalysisQueueWorker(
    harness.processor,
    { targetJobId, targetOrganizationId: organizationId, pollIntervalMs: 1, leaseDurationMs: 1000 },
    harness.pool,
    harness.analysis,
  );

  await worker.run();

  assert.equal(harness.processorCalls, 0);
  assert.equal(harness.acknowledgmentUpdates, 1);
});
