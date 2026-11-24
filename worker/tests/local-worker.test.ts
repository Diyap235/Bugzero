import assert from 'node:assert/strict';
import test from 'node:test';

import {
  acquireAnalysisWorkerLock,
  LocalAnalysisWorkerSupervisor,
  type WorkerLockClient,
  type LocalAnalysisWorkerRuntime,
} from '../src/local-worker.js';

const pooledQueueUrl = 'postgresql://bugzero_queue_worker:fixture@ep-test-pooler.c-2.us-east-2.aws.neon.tech/neondb?sslmode=require';
const directQueueLockUrl = 'postgresql://bugzero_queue_worker:fixture@ep-test.c-2.us-east-2.aws.neon.tech/neondb?sslmode=require';

function deferred(): { promise: Promise<void>; resolve(): void } {
  let resolve!: () => void;
  const promise = new Promise<void>((complete) => { resolve = complete; });
  return { promise, resolve };
}

function deferredError(): { promise: Promise<Error>; resolve(error: Error): void } {
  let resolve!: (error: Error) => void;
  const promise = new Promise<Error>((complete) => { resolve = complete; });
  return { promise, resolve };
}

class FakeWorkerLockClient implements WorkerLockClient {
  queries: Array<{ sql: string; values?: readonly unknown[] }> = [];
  endCalls = 0;
  lockAcquired = true;
  unlockResult = true;
  role = 'bugzero_queue_worker';
  bypassRls = false;
  connectFailure: Error | null = null;
  lockFailure: Error | null = null;
  unlockFailure: Error | null = null;
  private errorListener: ((error: Error) => void) | null = null;

  async connect(): Promise<void> {
    if (this.connectFailure) throw this.connectFailure;
  }

  async query(sql: string, values?: readonly unknown[]): Promise<{ rows: Array<Record<string, unknown>> }> {
    this.queries.push({ sql, values });
    if (sql.includes('session_user')) {
      return { rows: [{ session_user: this.role, rolbypassrls: this.bypassRls }] };
    }
    if (sql.includes('pg_try_advisory_lock')) {
      if (this.lockFailure) throw this.lockFailure;
      return { rows: [{ acquired: this.lockAcquired }] };
    }
    if (sql.includes('pg_advisory_unlock')) {
      if (this.unlockFailure) throw this.unlockFailure;
      return { rows: [{ unlocked: this.unlockResult }] };
    }
    throw new Error('Unexpected lock query');
  }

  async end(): Promise<void> {
    this.endCalls += 1;
  }

  onError(listener: (error: Error) => void): void {
    this.errorListener = listener;
  }

  emitError(error: Error): void {
    this.errorListener?.(error);
  }
}

function lockOptions(client: FakeWorkerLockClient) {
  return {
    queueDatabaseUrl: pooledQueueUrl,
    lockDatabaseUrl: directQueueLockUrl,
    createClient: () => client,
  };
}

test('local worker supervisor automatically polls and processes a newly queued job', async () => {
  const queuedJobs: string[] = [];
  const processedJobs: string[] = [];
  const workerStarted = deferred();
  const jobProcessed = deferred();
  let running = false;
  let lockReleaseCount = 0;
  const runtime: LocalAnalysisWorkerRuntime = {
    acquireLock: async () => ({
      lost: new Promise<Error>(() => {}),
      release: async () => { lockReleaseCount += 1; },
    }),
    createWorker: () => ({
      async run() {
        running = true;
        workerStarted.resolve();
        while (running) {
          const job = queuedJobs.shift();
          if (job) {
            processedJobs.push(job);
            jobProcessed.resolve();
          }
          await new Promise<void>((resolve) => setTimeout(resolve, 1));
        }
      },
      async close() {
        running = false;
      },
    }),
  };
  const supervisor = new LocalAnalysisWorkerSupervisor(runtime, 1, 5);
  const handle = supervisor.start();

  await workerStarted.promise;
  queuedJobs.push('new-analysis');
  await jobProcessed.promise;
  await Promise.all([handle.stop(), handle.stop()]);

  assert.deepEqual(processedJobs, ['new-analysis']);
  assert.equal(lockReleaseCount, 1);
});

test('only one supervisor starts a worker while the shared singleton lock is held', async () => {
  let lockHeld = false;
  let workerStarts = 0;
  const secondLockAttempt = deferred();
  const firstStarted = deferred();
  const secondStarted = deferred();
  const runtime: LocalAnalysisWorkerRuntime = {
    acquireLock: async () => {
      if (lockHeld) {
        secondLockAttempt.resolve();
        return null;
      }
      lockHeld = true;
      return { lost: new Promise<Error>(() => {}), release: async () => { lockHeld = false; } };
    },
    createWorker: () => {
      workerStarts += 1;
      const started = workerStarts === 1 ? firstStarted : secondStarted;
      let finish!: () => void;
      return {
        run: async () => {
          started.resolve();
          await new Promise<void>((resolve) => { finish = resolve; });
        },
        close: async () => { finish?.(); },
      };
    },
  };
  const first = new LocalAnalysisWorkerSupervisor(runtime, 1, 5);
  const second = new LocalAnalysisWorkerSupervisor(runtime, 1, 5);
  const firstHandle = first.start();
  await firstStarted.promise;
  const secondHandle = second.start();
  await secondLockAttempt.promise;

  assert.equal(workerStarts, 1);
  await firstHandle.stop();
  await secondStarted.promise;
  assert.equal(workerStarts, 2);
  await secondHandle.stop();
});

test('a crashed worker is restarted so expired leased work can be recovered', async () => {
  let starts = 0;
  let releasedLocks = 0;
  const restarted = deferred();
  const runtime: LocalAnalysisWorkerRuntime = {
    acquireLock: async () => ({
      lost: new Promise<Error>(() => {}),
      release: async () => { releasedLocks += 1; },
    }),
    createWorker: () => {
      starts += 1;
      if (starts === 1) {
        return {
          run: async () => { throw new Error('simulated worker crash'); },
          close: async () => undefined,
        };
      }
      let finish!: () => void;
      return {
        run: async () => {
          restarted.resolve();
          await new Promise<void>((resolve) => { finish = resolve; });
        },
        close: async () => { finish?.(); },
      };
    },
  };
  const supervisor = new LocalAnalysisWorkerSupervisor(runtime, 1, 5);
  const handle = supervisor.start();

  await restarted.promise;
  assert.equal(starts, 2);
  assert.equal(releasedLocks, 1);
  await handle.stop();
  assert.equal(releasedLocks, 2);
});

test('lock acquisition and release use one direct client and preserve the advisory key', async () => {
  const client = new FakeWorkerLockClient();
  const lock = await acquireAnalysisWorkerLock(lockOptions(client));
  assert.ok(lock);
  const acquireQuery = client.queries.find((query) => query.sql.includes('pg_try_advisory_lock'));
  assert.deepEqual(acquireQuery?.values, [0x42555A5A, 0x4C4F434C]);

  const firstRelease = lock.release();
  assert.equal(lock.release(), firstRelease);
  await firstRelease;
  const releaseQuery = client.queries.find((query) => query.sql.includes('pg_advisory_unlock'));
  assert.deepEqual(releaseQuery?.values, acquireQuery?.values);
  assert.equal(client.endCalls, 1);
});

test('a competing worker is rejected and its direct connection is closed', async () => {
  const client = new FakeWorkerLockClient();
  client.lockAcquired = false;

  assert.equal(await acquireAnalysisWorkerLock(lockOptions(client)), null);
  assert.equal(client.queries.some((query) => query.sql.includes('pg_advisory_unlock')), false);
  assert.equal(client.endCalls, 1);
});

test('connection failures close the direct client and preserve the sanitized failure', async () => {
  const client = new FakeWorkerLockClient();
  client.connectFailure = new Error('connection failed');

  await assert.rejects(acquireAnalysisWorkerLock(lockOptions(client)), /connection failed/);
  assert.equal(client.endCalls, 1);
});

test('lock acquisition query failures close the direct client', async () => {
  const client = new FakeWorkerLockClient();
  client.lockFailure = new Error('lock query failed');

  await assert.rejects(acquireAnalysisWorkerLock(lockOptions(client)), /lock query failed/);
  assert.equal(client.endCalls, 1);
});

test('the direct connection verifies the effective worker role and BYPASSRLS attribute', async () => {
  for (const invalid of [
    { role: 'another_role', bypassRls: false },
    { role: 'bugzero_queue_worker', bypassRls: true },
  ]) {
    const client = new FakeWorkerLockClient();
    client.role = invalid.role;
    client.bypassRls = invalid.bypassRls;
    await assert.rejects(
      acquireAnalysisWorkerLock(lockOptions(client)),
      /non-BYPASSRLS bugzero_queue_worker database role/,
    );
    assert.equal(client.queries.some((query) => query.sql.includes('pg_try_advisory_lock')), false);
    assert.equal(client.endCalls, 1);
  }
});

test('release failure still closes the connection and repeated release stays idempotent', async () => {
  const client = new FakeWorkerLockClient();
  client.unlockFailure = new Error('unlock failed');
  const lock = await acquireAnalysisWorkerLock(lockOptions(client));
  assert.ok(lock);

  const firstRelease = lock.release();
  assert.equal(lock.release(), firstRelease);
  await assert.rejects(firstRelease, /unlock failed/);
  assert.equal(client.endCalls, 1);
});

test('unexpected client errors mark lock ownership lost and skip unlock on a dead session', async () => {
  const client = new FakeWorkerLockClient();
  const lock = await acquireAnalysisWorkerLock(lockOptions(client));
  assert.ok(lock);
  const connectionError = new Error('socket closed');

  client.emitError(connectionError);
  assert.equal(await lock.lost, connectionError);
  await lock.release();

  assert.equal(client.queries.some((query) => query.sql.includes('pg_advisory_unlock')), false);
  assert.equal(client.endCalls, 1);
});

test('an unexpectedly terminated lock connection stops the worker and releases once', async () => {
  const lost = deferredError();
  const started = deferred();
  const released = deferred();
  let running = false;
  let releaseCount = 0;
  let closeCount = 0;
  const runtime: LocalAnalysisWorkerRuntime = {
    acquireLock: async () => ({
      lost: lost.promise,
      release: async () => {
        releaseCount += 1;
        released.resolve();
      },
    }),
    createWorker: () => ({
      async run() {
        running = true;
        started.resolve();
        while (running) await new Promise<void>((resolve) => setTimeout(resolve, 1));
      },
      async close() {
        closeCount += 1;
        running = false;
      },
    }),
  };
  const handle = new LocalAnalysisWorkerSupervisor(runtime, 1, 5).start();
  await started.promise;
  lost.resolve(new Error('connection lost'));
  await released.promise;
  await handle.stop();

  assert.equal(releaseCount, 1);
  assert.equal(closeCount, 1);
});
