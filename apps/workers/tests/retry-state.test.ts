import test from 'node:test';
import assert from 'node:assert/strict';
import type {
  AnalysisJob,
  AnalysisProfile,
  AnalysisRun,
  RepositoryCommit,
  RepositoryRecord,
} from '@bugzero/database';
import { processAnalysisQueuePayload } from '../src/jobs/analysis-queue.js';
import { AnalysisJobProcessor } from '../src/jobs/process-analysis-job.js';

const organizationId = '11111111-1111-4111-8111-111111111111';
const repositoryId = '22222222-2222-4222-8222-222222222222';
const commitId = '33333333-3333-4333-8333-333333333333';
const runId = '44444444-4444-4444-8444-444444444444';
const jobId = '55555555-5555-4555-8555-555555555555';

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
      entities: { async createOrUpdate() { throw new Error('unexpected entity persistence'); } },
      relationships: { async createOrGet() { throw new Error('unexpected relationship persistence'); } },
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
    assert.deepEqual(jobStates, ['RUNNING', scenario.status]);
    assert.equal(job.status, scenario.status);
    assert.equal(job.attempt, scenario.attempt);
    assert.equal(run.status, scenario.runStatus);
    assert.equal(
      (run.coverage.pipeline as Record<string, unknown>).status,
      scenario.pipelineStatus,
    );
  }
});
