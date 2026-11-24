import test from 'node:test';
import assert from 'node:assert/strict';
import type { AnalysisJob, AnalysisProfile, AnalysisRun, RepositoryCommit, RepositoryRecord } from '@bugzero/database';
import { createApiServer } from '../../src/server.js';

test('POST /analysis persists durable work; repeated requests reuse active run/job', async () => {
  const organizationId = '11111111-1111-4111-8111-111111111111';
  const repositoryId = '22222222-2222-4222-8222-222222222222';
  const commitId = '33333333-3333-4333-8333-333333333333';
  const userId = '44444444-4444-4444-8444-444444444444';
  const repository: RepositoryRecord = {
    id: repositoryId,
    organization_id: organizationId,
    provider: 'GITHUB',
    external_id: 'fixture',
    full_name: 'org/fixture',
    default_branch: 'main',
    clone_url: 'https://example.invalid/org/fixture.git',
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
    analyzers: [{ name: 'structural-quality-analyzer', type: 'STRUCTURAL' }],
    max_depth: 3,
    created_at: new Date(0).toISOString(),
  };
  const runs = new Map<string, AnalysisRun>();
  const jobs = new Map<string, AnalysisJob>();
  const identityToJob = new Map<string, string>();
  let workCreationCount = 0;

  const app = createApiServer({
    async authenticate() {
      return { organizationId, userId };
    },
    analysis: {
      async ensureDefaultProfile() { return profile; },
      async getLatestProfile() { return profile; },
      async createOrGetActiveWork(input) {
        const existingJobId = identityToJob.get(input.idempotencyKey);
        if (existingJobId) {
          const existingJob = jobs.get(existingJobId);
          const existingRun = existingJob ? runs.get(existingJob.run_id) : undefined;
          if (existingJob && existingRun && ['QUEUED', 'RUNNING', 'RETRY'].includes(existingJob.status)) {
            return { run: existingRun, job: existingJob, created: false };
          }
        }
        workCreationCount += 1;
        const run: AnalysisRun = {
          id: `55555555-5555-4555-8555-${String(workCreationCount).padStart(12, '0')}`,
          organization_id: organizationId,
          repository_id: input.repositoryId,
          commit_id: input.commitId,
          profile_id: input.profileId,
          profile_version: input.profileVersion,
          scope: input.scope,
          status: 'NOT_STARTED',
          coverage: {},
          created_at: new Date(0).toISOString(),
          started_at: null,
          completed_at: null,
        };
        const job: AnalysisJob = {
          id: `66666666-6666-4666-8666-${String(workCreationCount).padStart(12, '0')}`,
          organization_id: organizationId,
          run_id: run.id,
          stage: 'PARSING',
          analyzer: input.analyzer,
          analyzer_type: input.analyzerType,
          scope_key: input.scopeKey,
          status: 'QUEUED',
          attempt: 0,
          idempotency_key: input.idempotencyKey,
          created_at: new Date(0).toISOString(),
          started_at: null,
          finished_at: null,
        };
        runs.set(run.id, run);
        jobs.set(job.id, job);
        identityToJob.set(input.idempotencyKey, job.id);
        return { run, job, created: true };
      },
      async getRun(_orgId, runId) { return runs.get(runId) ?? null; },
      async getLatestJobForRun(_orgId, runId) {
        return Array.from(jobs.values()).find((job) => job.run_id === runId) ?? null;
      },
      async updateJobStatus(_orgId, jobId, status) {
        const job = jobs.get(jobId);
        if (!job) throw new Error('job missing');
        job.status = status;
        return job;
      },
      async updateRunStatus(_orgId, runId, status, coverage) {
        const run = runs.get(runId);
        if (!run) throw new Error('run missing');
        run.status = status;
        run.coverage = coverage;
        return run;
      },
    },
    repositories: {
      async getById(orgId, id) {
        return orgId === organizationId && id === repositoryId ? repository : null;
      },
    },
    commits: {
      async getByCommitSha(orgId, repoId, sha) {
        return orgId === organizationId && repoId === repositoryId && sha === commit.commit_sha ? commit : null;
      },
    },
    members: {
      async getMembership(orgId, requestedUserId) {
        return orgId === organizationId && requestedUserId === userId
          ? { id: 'member', organization_id: organizationId, user_id: userId, role: 'DEVELOPER', created_at: '', updated_at: '' }
          : null;
      },
    },
  });

  try {
    const requestBody = {
      repositoryId,
      commitSha: commit.commit_sha,
      profileId: 'default',
      scope: 'COMMIT',
    };
    const firstResponse = await app.inject({ method: 'POST', url: '/analysis', payload: requestBody });
    assert.equal(firstResponse.statusCode, 202);
    const first = firstResponse.json() as { analysisRunId: string; jobId: string; status: string };
    assert.equal(first.status, 'QUEUED');
    assert.equal(runs.size, 1);
    assert.equal(jobs.size, 1);

    const replayResponse = await app.inject({ method: 'POST', url: '/analysis', payload: requestBody });
    assert.equal(replayResponse.statusCode, 202);
    const replay = replayResponse.json() as { analysisRunId: string; jobId: string };
    assert.equal(replay.analysisRunId, first.analysisRunId);
    assert.equal(replay.jobId, first.jobId);
    assert.equal(workCreationCount, 1);
    assert.equal(runs.get(first.analysisRunId)?.scope, 'COMMIT');

    const repositoryScopeResponse = await app.inject({
      method: 'POST',
      url: '/analysis',
      payload: { ...requestBody, scope: 'REPOSITORY' },
    });
    assert.equal(repositoryScopeResponse.statusCode, 202);
    const repositoryScope = repositoryScopeResponse.json() as { analysisRunId: string; jobId: string };
    assert.equal(workCreationCount, 2);
    assert.equal(runs.get(repositoryScope.analysisRunId)?.scope, 'REPOSITORY');
    assert.equal(jobs.get(repositoryScope.jobId)?.scope_key, JSON.stringify({
      mode: 'REPOSITORY',
      fileIds: [],
      changedEntityIds: [],
    }));

    const persistedRun = runs.get(first.analysisRunId);
    assert.ok(persistedRun);
    persistedRun.coverage = {
      pipeline: {
        timings: { mlSignalsMs: 49_647, endToEndMs: 62_241 },
        aiReview: {
          status: 'FAILED',
          errorCode: 'PROVIDER_ERROR',
          providerStatus: 410,
          attempts: 1,
          result: null,
        },
      },
    };
    const statusResponse = await app.inject({ method: 'GET', url: `/analysis/${first.analysisRunId}` });
    assert.equal(statusResponse.statusCode, 200);
    const status = statusResponse.json();
    assert.equal(status.analysisRunId, first.analysisRunId);
    assert.equal(status.job.stage, 'PARSING');
    assert.deepEqual(status.progress.timings, { mlSignalsMs: 49_647, endToEndMs: 62_241 });
    assert.deepEqual(status.progress.aiReview, {
      status: 'FAILED',
      errorCode: 'PROVIDER_ERROR',
      providerStatus: 410,
      attempts: 1,
      result: null,
    });
  } finally {
    await app.close();
  }
});

test('POST /analysis rejects a repository outside the authenticated organization', async () => {
  const app = createApiServer({
    async authenticate() {
      return { organizationId: '11111111-1111-4111-8111-111111111111', userId: '44444444-4444-4444-8444-444444444444' };
    },
    analysis: {
      async ensureDefaultProfile() { throw new Error('must not resolve profile'); },
      async getLatestProfile() { return null; },
      async createOrGetActiveWork() { throw new Error('must not create work'); },
      async getRun() { return null; },
      async getLatestJobForRun() { return null; },
      async updateJobStatus() { throw new Error('must not update jobs'); },
      async updateRunStatus() { throw new Error('must not update runs'); },
    },
    repositories: { async getById() { return null; } },
    commits: { async getByCommitSha() { return null; } },
    members: {
      async getMembership() {
        return { id: 'member', organization_id: '11111111-1111-4111-8111-111111111111', user_id: '44444444-4444-4444-8444-444444444444', role: 'DEVELOPER', created_at: '', updated_at: '' };
      },
    },
  });

  try {
    const response = await app.inject({
      method: 'POST',
      url: '/analysis',
      payload: {
        repositoryId: '22222222-2222-4222-8222-222222222222',
        commitSha: 'a'.repeat(40),
      },
    });
    assert.equal(response.statusCode, 404);
  } finally {
    await app.close();
  }
});

test('POST /analysis returns accepted after durable PostgreSQL job creation', async () => {
  const organizationId = '11111111-1111-4111-8111-111111111111';
  const repositoryId = '22222222-2222-4222-8222-222222222222';
  const run: AnalysisRun = {
    id: '55555555-5555-4555-8555-555555555555',
    organization_id: organizationId,
    repository_id: repositoryId,
    commit_id: '33333333-3333-4333-8333-333333333333',
    profile_id: 'default',
    profile_version: '1',
    scope: 'COMMIT',
    status: 'NOT_STARTED',
    coverage: {},
    created_at: new Date(0).toISOString(),
    started_at: null,
    completed_at: null,
  };
  const job: AnalysisJob = {
    id: '66666666-6666-4666-8666-666666666666',
    organization_id: organizationId,
    run_id: run.id,
    stage: 'PARSING',
    analyzer: 'structural-quality-analyzer',
    analyzer_type: 'STRUCTURAL',
    scope_key: '{"mode":"COMMIT","fileIds":[],"changedEntityIds":[]}',
    status: 'QUEUED',
    attempt: 0,
    idempotency_key: 'identity',
    created_at: new Date(0).toISOString(),
    started_at: null,
    finished_at: null,
  };
  const app = createApiServer({
    async authenticate() {
      return { organizationId, userId: '44444444-4444-4444-8444-444444444444' };
    },
    analysis: {
      async ensureDefaultProfile() {
        return {
          id: 'default', organization_id: organizationId, version: '1',
          analyzers: [{ name: 'structural-quality-analyzer', type: 'STRUCTURAL' }],
          max_depth: 3, created_at: '',
        };
      },
      async getLatestProfile() { return null; },
      async createOrGetActiveWork() { return { run, job, created: true }; },
      async getRun() { return run; },
      async getLatestJobForRun() { return job; },
      async updateJobStatus(_orgId, _jobId, status) { job.status = status; return job; },
      async updateRunStatus(_orgId, _runId, status, coverage) { run.status = status; run.coverage = coverage; return run; },
    },
    repositories: {
      async getById() {
        return {
          id: repositoryId, organization_id: organizationId, provider: 'GITHUB', external_id: 'repo',
          full_name: 'org/repo', default_branch: 'main', clone_url: 'https://example.invalid/repo.git',
          created_at: '', updated_at: '',
        };
      },
    },
    commits: {
      async getByCommitSha() {
        return {
          id: run.commit_id, organization_id: organizationId, repository_id: repositoryId,
          commit_sha: 'a'.repeat(40), parent_commit_sha: null, committed_at: null, indexed_at: null, created_at: '',
        };
      },
    },
    members: {
      async getMembership() {
        return {
          id: 'member', organization_id: organizationId, user_id: '44444444-4444-4444-8444-444444444444',
          role: 'DEVELOPER', created_at: '', updated_at: '',
        };
      },
    },
  });

  try {
    const response = await app.inject({
      method: 'POST',
      url: '/analysis',
      payload: { repositoryId, commitSha: 'a'.repeat(40) },
    });
    assert.equal(response.statusCode, 202);
    assert.equal(job.status, 'QUEUED');
    assert.equal(run.status, 'NOT_STARTED');
  } finally {
    await app.close();
  }
});
