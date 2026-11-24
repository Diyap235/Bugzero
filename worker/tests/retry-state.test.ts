import test from 'node:test';
import assert from 'node:assert/strict';
import type { Pool } from 'pg';
import type {
  AnalysisJob,
  AnalysisProfile,
  AnalysisRun,
  RepositoryCommit,
  RepositoryRecord,
} from '@bugzero/database';
import {
  createAnalysisQueueWorker,
  processAnalysisQueuePayload,
} from '../src/jobs/analysis-queue.js';
import { AnalysisJobProcessor } from '../src/jobs/process-analysis-job.js';
import { NvidiaInvestigator } from '../src/ai/nvidia/nvidia-client.js';

const disabledAiInvestigator = new NvidiaInvestigator({ environment: {} });

const organizationId = '11111111-1111-4111-8111-111111111111';
const repositoryId = '22222222-2222-4222-8222-222222222222';
const commitId = '33333333-3333-4333-8333-333333333333';
const runId = '44444444-4444-4444-8444-444444444444';
const jobId = '55555555-5555-4555-8555-555555555555';

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((complete) => { resolve = complete; });
  return { promise, resolve };
}

class QueueDatabase {
  status = 'QUEUED';
  attempt = 0;
  leaseOwner: string | null = null;
  clock = 0;
  leaseExpiresAt = 0;
  renewals = 0;
  activeRenewals = 0;
  maxConcurrentRenewals = 0;
  acknowledgementCount = 0;
  claimCount = 0;
  renewalMode: 'success' | 'failure' | 'reclaimed' = 'success';
  acknowledgementFailure: Error | null = null;
  onRenewal?: () => void;
  onCandidateCheck?: () => void;
  readonly statements: string[] = [];
  readonly pool: Pool;

  constructor(private readonly maxAttempts: number) {
    const client = {
      query: (sql: string, values: unknown[] = []) => this.query(sql, values),
      release: () => undefined,
    };
    this.pool = {
      connect: async () => client,
      query: (sql: string, values: unknown[] = []) => this.query(sql, values),
    } as unknown as Pool;
  }

  advanceToLeaseExpiry(): void {
    this.clock = this.leaseExpiresAt;
  }

  private async query(
    sql: string,
    values: unknown[],
  ): Promise<{ rows: Record<string, unknown>[]; rowCount: number }> {
    this.statements.push(sql);
    if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql.trim())) return { rows: [], rowCount: 0 };
    if (sql.includes('set_config')) return { rows: [], rowCount: 1 };
    if (sql.includes('FROM pg_roles')) {
      return {
        rows: [{ session_user: 'bugzero_queue_worker', rolbypassrls: false }],
        rowCount: 1,
      };
    }
    if (sql.includes('SET lease_expires_at = now()')) {
      this.activeRenewals += 1;
      this.maxConcurrentRenewals = Math.max(this.maxConcurrentRenewals, this.activeRenewals);
      try {
        if (this.renewalMode === 'failure') throw new Error('simulated database renewal failure');
        if (this.renewalMode === 'reclaimed') {
          this.status = 'RUNNING';
          this.attempt += 1;
          this.claimCount += 1;
          this.leaseOwner = 'reclaimed-worker-token';
          this.leaseExpiresAt = this.clock + Number(values[2]);
          return { rows: [], rowCount: 0 };
        }
        this.clock += Math.max(1, Math.floor(Number(values[2]) / 3));
        if (
          this.status !== 'RUNNING'
          || this.leaseOwner !== values[3]
          || this.leaseExpiresAt <= this.clock
        ) return { rows: [], rowCount: 0 };
        this.leaseExpiresAt = this.clock + Number(values[2]);
        this.renewals += 1;
        this.onRenewal?.();
        return { rows: [], rowCount: 1 };
      } finally {
        this.activeRenewals -= 1;
      }
    }
    if (sql.includes("SET status = 'DEAD_LETTER'")) return { rows: [], rowCount: 0 };
    if (sql.includes('WITH candidate AS')) {
      this.onCandidateCheck?.();
      const leaseAvailable = this.leaseOwner === null || this.leaseExpiresAt <= this.clock;
      const ready = (['QUEUED', 'RETRY'].includes(this.status) && leaseAvailable)
        || (this.status === 'RUNNING' && this.leaseExpiresAt <= this.clock);
      if (!ready || this.attempt >= this.maxAttempts) return { rows: [], rowCount: 0 };
      this.status = 'RUNNING';
      this.attempt += 1;
      this.leaseOwner = String(values[0]);
      this.leaseExpiresAt = this.clock + Number(values[1]);
      this.claimCount += 1;
      return {
        rows: [{
          organization_id: organizationId,
          id: jobId,
          attempt: this.attempt,
          max_attempts: this.maxAttempts,
          lease_owner: this.leaseOwner,
        }],
        rowCount: 1,
      };
    }
    if (sql.includes('SELECT organization_id, id, run_id, status, attempt, max_attempts')) {
      this.acknowledgementCount += 1;
      if (this.acknowledgementFailure) throw this.acknowledgementFailure;
      if (
        !this.leaseOwner
        || this.leaseOwner !== values[2]
        || this.leaseExpiresAt <= this.clock
      ) return { rows: [], rowCount: 0 };
      return {
        rows: [{
          organization_id: organizationId,
          id: jobId,
          run_id: runId,
          status: this.status,
          attempt: this.attempt,
          max_attempts: this.maxAttempts,
        }],
        rowCount: 1,
      };
    }
    if (sql.includes("SET status = $4")) {
      this.status = String(values[3]);
      this.leaseOwner = null;
      this.leaseExpiresAt = 0;
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes('SET available_at = now()')) {
      this.status = 'RETRY';
      this.leaseOwner = null;
      this.leaseExpiresAt = 0;
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes('SET lease_owner = NULL')) {
      this.leaseOwner = null;
      this.leaseExpiresAt = 0;
      return { rows: [], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  }
}

test('queue payload validation preserves attempt metadata for retry-aware processors', async () => {
  const attempt = { attempt: 2, maxAttempts: 3 };
  const received = await processAnalysisQueuePayload(
    { organizationId, jobId },
    async (_payload, context) => context,
    attempt,
  );

  assert.deepEqual(received, attempt);
  await assert.rejects(
    processAnalysisQueuePayload({ organizationId, jobId }, async () => undefined, { attempt: 4, maxAttempts: 3 }),
    /attempt metadata is invalid/,
  );
});

test('PostgreSQL worker atomically claims, processes and acknowledges a durable job', async () => {
  const database = new QueueDatabase(3);
  let signalStarted!: () => void;
  const started = new Promise<void>((resolve) => { signalStarted = resolve; });
  const worker = createAnalysisQueueWorker(async (_payload, attempt) => {
    assert.deepEqual(attempt, { attempt: 1, maxAttempts: 3 });
    signalStarted();
  }, { pollIntervalMs: 5, leaseDurationMs: 1000 }, database.pool);
  const loop = worker.run();
  await started;
  await worker.close();
  await loop;

  assert.equal(database.status, 'COMPLETED');
  assert.equal(database.leaseOwner, null);
  assert.ok(database.statements.some((sql) => sql.includes('FOR UPDATE SKIP LOCKED')));
  assert.ok(database.statements.some((sql) => sql.includes('lease_owner = $3')));
  assert.ok(database.statements.some((sql) => sql.includes('FROM pg_roles')));
  assert.ok(database.statements.some((sql) =>
    sql.includes("finished_at = CASE WHEN $4 IN ('COMPLETED', 'DEAD_LETTER') THEN now() ELSE NULL END")));
  assert.ok(database.statements.every((sql) => !sql.includes('app.analysis_worker')));
});

test('PostgreSQL worker releases failed jobs for bounded retries with a lease delay', async () => {
  const database = new QueueDatabase(2);
  let signalStarted!: () => void;
  const started = new Promise<void>((resolve) => { signalStarted = resolve; });
  const worker = createAnalysisQueueWorker(async () => {
    signalStarted();
    throw new Error('temporary failure');
  }, { pollIntervalMs: 5, leaseDurationMs: 1000, retryBaseDelayMs: 2 }, database.pool);
  const loop = worker.run();
  await started;
  await worker.close();
  await loop;

  assert.equal(database.status, 'RETRY');
  assert.equal(database.leaseOwner, null);
  assert.ok(database.statements.some((sql) =>
    sql.includes("SET status = $4")
    && sql.includes("available_at = CASE WHEN $4 = 'RETRY'")));
});

test('long-running jobs renew serially and complete beyond their initial lease', async () => {
  const database = new QueueDatabase(3);
  const fourthRenewal = deferred();
  database.onRenewal = () => {
    if (database.renewals === 4) fourthRenewal.resolve();
  };
  const worker = createAnalysisQueueWorker(async () => {
    await fourthRenewal.promise;
  }, { pollIntervalMs: 2, leaseDurationMs: 30 }, database.pool);
  const loop = worker.run();
  await fourthRenewal.promise;
  await worker.close();
  await loop;

  assert.equal(database.status, 'COMPLETED');
  assert.ok(database.clock > 30);
  assert.equal(database.renewals, 4);
  assert.equal(database.maxConcurrentRenewals, 1);
});

test('renewal failure aborts processing and never acknowledges or retries without ownership', async () => {
  const database = new QueueDatabase(3);
  database.renewalMode = 'failure';
  const started = deferred();
  const aborted = deferred();
  const worker = createAnalysisQueueWorker(async (_payload, _attempt, signal) => {
    started.resolve();
    await new Promise<void>((_resolve, reject) => {
      signal?.addEventListener('abort', () => {
        aborted.resolve();
        reject(signal.reason);
      }, { once: true });
    });
  }, { pollIntervalMs: 2, leaseDurationMs: 30 }, database.pool);
  const loop = worker.run();
  await started.promise;
  await aborted.promise;
  await worker.close();
  await loop;

  assert.equal(database.status, 'RUNNING');
  assert.equal(database.acknowledgementCount, 0);
  assert.equal(database.attempt, 1);
});

test('an expired lease reclaimed with a new token cannot be acknowledged by the stale worker', async () => {
  const database = new QueueDatabase(3);
  database.renewalMode = 'reclaimed';
  const started = deferred();
  const aborted = deferred();
  const worker = createAnalysisQueueWorker(async (_payload, _attempt, signal) => {
    started.resolve();
    await new Promise<void>((_resolve, reject) => {
      signal?.addEventListener('abort', () => {
        aborted.resolve();
        reject(signal.reason);
      }, { once: true });
    });
  }, { concurrency: 1, pollIntervalMs: 2, leaseDurationMs: 30 }, database.pool);
  const loop = worker.run();
  await started.promise;
  database.advanceToLeaseExpiry();
  await aborted.promise;
  await worker.close();
  await loop;

  assert.equal(database.claimCount, 2);
  assert.equal(database.leaseOwner, 'reclaimed-worker-token');
  assert.equal(database.attempt, 2);
  assert.equal(database.acknowledgementCount, 0);
  assert.equal(database.status, 'RUNNING');
});

test('concurrent workers do not claim the same unexpired job', async () => {
  const database = new QueueDatabase(3);
  let processCount = 0;
  const processor = async () => {
    processCount += 1;
  };
  const first = createAnalysisQueueWorker(processor, { pollIntervalMs: 2, leaseDurationMs: 1000 }, database.pool);
  const second = createAnalysisQueueWorker(processor, { pollIntervalMs: 2, leaseDurationMs: 1000 }, database.pool);
  const loops = [first.run(), second.run()];
  while (processCount === 0) await new Promise<void>((resolve) => setImmediate(resolve));
  await Promise.all([first.close(), second.close()]);
  await Promise.all(loops);

  assert.equal(processCount, 1);
  assert.equal(database.claimCount, 1);
  assert.ok(database.statements.filter((sql) => sql.includes('FOR UPDATE SKIP LOCKED')).length >= 2);
});

test('a RETRY row with an unexpired lease remains owned until that lease expires', async () => {
  const database = new QueueDatabase(3);
  database.status = 'RETRY';
  database.attempt = 1;
  database.leaseOwner = 'previous-owner-token';
  database.leaseExpiresAt = 100;
  const candidateChecked = deferred();
  database.onCandidateCheck = () => candidateChecked.resolve();
  let processorCalls = 0;
  const worker = createAnalysisQueueWorker(async () => { processorCalls += 1; }, {
    concurrency: 1,
    pollIntervalMs: 2,
    leaseDurationMs: 1000,
  }, database.pool);
  const loop = worker.run();
  await candidateChecked.promise;
  await worker.close();
  await loop;

  assert.equal(database.claimCount, 0);
  assert.equal(processorCalls, 0);
  assert.equal(database.leaseOwner, 'previous-owner-token');
});

test('the original processor error remains available when acknowledgment also fails', async () => {
  const database = new QueueDatabase(3);
  database.acknowledgementFailure = new Error('acknowledgment database failure');
  const started = deferred();
  const logged: string[] = [];
  const originalConsoleError = console.error;
  console.error = (value?: unknown): void => { logged.push(String(value)); };
  const worker = createAnalysisQueueWorker(async () => {
    started.resolve();
    throw new Error('original parser failure');
  }, { pollIntervalMs: 2, leaseDurationMs: 1000 }, database.pool);
  try {
    const loop = worker.run();
    await started.promise;
    await worker.close();
    await loop;
  } finally {
    console.error = originalConsoleError;
  }

  const processingError = logged.map((line) => JSON.parse(line) as {
    event: string;
    errorCauses?: { errorMessage: string }[];
  }).find((entry) => entry.event === 'analysis.queue.processing_error');
  assert.ok(processingError);
  assert.deepEqual(processingError.errorCauses?.map((cause) => cause.errorMessage), [
    'original parser failure',
    'acknowledgment database failure',
  ]);
});

test('a genuine failure on the final attempt dead-letters the queue job', async () => {
  const database = new QueueDatabase(1);
  const started = deferred();
  const logged: string[] = [];
  const originalConsoleError = console.error;
  console.error = (value?: unknown): void => { logged.push(String(value)); };
  const worker = createAnalysisQueueWorker(async () => {
    started.resolve();
    throw new Error('permanent processor failure');
  }, {
    pollIntervalMs: 2,
    leaseDurationMs: 1000,
    finalizeFailedRun: async () => undefined,
  }, database.pool);
  try {
    const loop = worker.run();
    await started.promise;
    await worker.close();
    await loop;
  } finally {
    console.error = originalConsoleError;
  }

  assert.equal(database.status, 'DEAD_LETTER');
  assert.ok(database.statements.some((sql) => sql.includes("SET status = $4")));
});

test('analysis failures remain retryable until the configured final attempt', async () => {
  const repository: RepositoryRecord = {
    id: repositoryId,
    organization_id: organizationId,
    provider: 'GITHUB',
    external_id: 'fixture',
    full_name: 'example/fixture',
    default_branch: 'main',
    clone_url: 'https://example.invalid/fixture.git',
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
  };
  const commit: RepositoryCommit = {
    id: commitId,
    organization_id: organizationId,
    repository_id: repositoryId,
    commit_sha: 'a'.repeat(40),
    parent_commit_sha: null,
    committed_at: null,
    indexed_at: null,
    created_at: new Date(0).toISOString(),
  };
  const profile: AnalysisProfile = {
    id: 'default',
    organization_id: organizationId,
    version: '1',
    analyzers: [],
    max_depth: 3,
    created_at: new Date(0).toISOString(),
  };

  for (const scenario of [
    { attempt: 1, status: 'RETRY', runStatus: 'RUNNING', pipelineStatus: 'RETRYING' },
    { attempt: 3, status: 'DEAD_LETTER', runStatus: 'FAILED', pipelineStatus: 'FAILED' },
  ] as const) {
    const job: AnalysisJob = {
      id: jobId,
      organization_id: organizationId,
      run_id: runId,
      stage: 'PARSING',
      analyzer: 'structural-quality-analyzer',
      analyzer_type: 'STRUCTURAL',
      scope_key: '{}',
      status: 'QUEUED',
      attempt: 0,
      idempotency_key: 'fixture',
      created_at: new Date(0).toISOString(),
      started_at: null,
      finished_at: null,
    };
    const run: AnalysisRun = {
      id: runId,
      organization_id: organizationId,
      repository_id: repositoryId,
      commit_id: commitId,
      profile_id: profile.id,
      profile_version: profile.version,
      scope: 'COMMIT',
      status: 'NOT_STARTED',
      coverage: {},
      created_at: new Date(0).toISOString(),
      started_at: null,
      completed_at: null,
    };
    const jobStates: string[] = [];
    const processor = new AnalysisJobProcessor({
      aiInvestigator: disabledAiInvestigator,
      analysis: {
        async getJob() { return job; },
        async getRun() { return run; },
        async getProfile() { return profile; },
        async updateJobStatus(_orgId, _jobId, status, attempt) {
          job.status = status;
          if (attempt !== undefined) job.attempt = attempt;
          jobStates.push(status);
          return job;
        },
        async updateJobStage(_orgId, _jobId, stage) { job.stage = stage; return job; },
        async updateRunStatus(_orgId, _runId, status, coverage) {
          run.status = status;
          run.coverage = coverage;
          return run;
        },
      },
      repositories: { async getById() { return repository; } },
      commits: { async getById() { return commit; } },
      graph: {
        async writeSnapshot() { throw new Error('unexpected graph persistence'); },
        async writeRelationships() { throw new Error('unexpected graph relationship persistence'); },
        async listByRun() { throw new Error('unexpected graph read'); },
      },
      intelligence: { async build() { throw new Error('unexpected intelligence build'); } },
      impact: { analyzeImpact() { throw new Error('unexpected impact analysis'); } },
      orchestrator: { async execute() { throw new Error('unexpected analyzer execution'); } },
      sources: {
        async readCommit() {
          throw new Error('fixture source read failure');
        },
      },
    });

    await assert.rejects(
      processor.process({ organizationId, jobId }, { attempt: scenario.attempt, maxAttempts: 3 }),
      /fixture source read failure/,
    );
    assert.deepEqual(jobStates, ['RUNNING']);
    assert.equal(job.status, 'RUNNING');
    assert.equal(job.attempt, scenario.attempt);
    assert.equal(run.status, scenario.runStatus);
    assert.equal(
      (run.coverage.pipeline as Record<string, unknown>).status,
      scenario.pipelineStatus,
    );
  }
});
