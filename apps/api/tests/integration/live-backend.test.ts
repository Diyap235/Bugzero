import assert from 'node:assert/strict';
import test from 'node:test';
import { generateKeyPairSync, sign } from 'node:crypto';
import { Redis } from 'ioredis';
import {
  AnalysisRepository,
  aiInvestigationRepository,
  CommitRepository,
  EvidenceRepository,
  FindingRepository,
  HealthRepository,
  MemberRepository,
  OrganizationRepository,
  RepositoryRepository,
  RiskAssessmentRepository,
  UserRepository,
  createDatabasePool,
  getDatabasePool,
  setTransactionOrganizationContext,
  withOrganizationContext,
} from '@bugzero/database';
import { getRedisUrl } from '@bugzero/config';
import { createAnalysisQueue, createAnalysisQueueWorker, enqueueAnalysisJob } from '@bugzero/workers/analysis-queue';
import { AnalysisJobProcessor } from '@bugzero/workers/analysis-processor';
import { GroqInvestigator } from '@bugzero/workers/ai/groq';
import { createSignedTokenAuthenticator } from '../../src/auth/signed-token.js';
import { createApiServer } from '../../src/server.js';

const enabled = process.env.BUGZERO_LIVE_INTEGRATION === '1';
const fixtureSha = 'a'.repeat(40);

function signedToken(privateKey: ReturnType<typeof generateKeyPairSync>['privateKey'], userId: string, organizationId: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'EdDSA', typ: 'JWT' })).toString('base64url');
  const claims = Buffer.from(JSON.stringify({
    sub: userId,
    org: organizationId,
    iss: 'bugzero-live-test',
    aud: 'bugzero-api',
    iat: now,
    exp: now + 600,
  })).toString('base64url');
  const content = `${header}.${claims}`;
  return `${content}.${sign(null, Buffer.from(content), privateKey).toString('base64url')}`;
}

async function waitForRun(
  app: ReturnType<typeof createApiServer>,
  token: string,
  runId: string,
  terminalStatuses: string[],
): Promise<{ status: string; job: { status: string } | null }> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const response = await app.inject({
      method: 'GET',
      url: `/analysis/${runId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(response.statusCode, 200, response.body);
    const status = response.json() as { status: string; job: { status: string } | null };
    if (status.job && terminalStatuses.includes(status.job.status)) return status;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Timed out waiting for analysis run ${runId}`);
}

async function cleanupTenant(
  pool: ReturnType<typeof createDatabasePool>,
  organizationId: string,
  userId: string | null,
  deleteUser: boolean,
): Promise<boolean> {
  return withOrganizationContext(organizationId, async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await setTransactionOrganizationContext(client);
      const immutableRecords = await client.query<{ exists: boolean }>(
        `SELECT EXISTS (SELECT 1 FROM evidence WHERE organization_id = $1)
          OR EXISTS (SELECT 1 FROM health_snapshots WHERE organization_id = $1) AS exists`,
        [organizationId],
      );
      if (immutableRecords.rows[0]?.exists) {
        await client.query('ROLLBACK');
        return false;
      }
      await client.query(
        'UPDATE findings SET current_occurrence_id = NULL, resolution_evidence_id = NULL WHERE organization_id = $1',
        [organizationId],
      );
      for (const table of [
        'evidence_edges',
        'evidence_nodes',
        'ai_explanations',
        'risk_assessments',
        'evidence',
        'finding_occurrences',
        'findings',
        'health_snapshots',
        'reports',
        'analysis_jobs',
        'code_relationships',
        'code_entities',
        'dependency_edges',
        'dependencies',
        'repository_files',
        'analysis_runs',
        'analysis_profiles',
        'audit_logs',
        'members',
        'repository_commits',
        'repositories',
      ]) {
        await client.query(`DELETE FROM ${table} WHERE organization_id = $1`, [organizationId]);
      }
      await client.query('DELETE FROM organizations WHERE id = $1', [organizationId]);
      if (deleteUser && userId) await client.query('DELETE FROM users WHERE id = $1', [userId]);
      await client.query('COMMIT');
      return true;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        throw new AggregateError([error, rollbackError], `Live integration cleanup rollback failed for organization ${organizationId}`);
      }
      throw error;
    } finally {
      client.release();
    }
  });
}

test('live authenticated analysis, replay, readback, retries, and tenant RLS', { skip: !enabled }, async () => {
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL must target the live PostgreSQL test database');
  assert.ok(process.env.REDIS_URL, 'REDIS_URL must target the live Redis-compatible test service');

  const pool = getDatabasePool();
  const cleanupPool = createDatabasePool({ connectionString: process.env.DATABASE_URL, max: 2 });
  const organizationId = crypto.randomUUID();
  const otherOrganizationId = crypto.randomUUID();
  const userEmail = `live-${crypto.randomUUID()}@bugzero.invalid`;
  let createdUserId: string | null = null;
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const authenticate = createSignedTokenAuthenticator({
    publicKey,
    issuer: 'bugzero-live-test',
    audience: 'bugzero-api',
  });
  const users = new UserRepository(pool);
  const members = new MemberRepository(pool);
  const repositories = new RepositoryRepository(pool);
  const commits = new CommitRepository(pool);
  const analyses = new AnalysisRepository(pool);
  const findings = new FindingRepository(pool);
  const evidence = new EvidenceRepository(pool);
  const risks = new RiskAssessmentRepository(pool);
  const health = new HealthRepository(pool);
  const redisForWorker = new Redis(getRedisUrl(), { maxRetriesPerRequest: null });
  const redisForReplayQueue = new Redis(getRedisUrl(), { maxRetriesPerRequest: null });
  const replayQueue = createAnalysisQueue(redisForReplayQueue);
  const longFunction = [
    'export function deliberatelyLongFunction() {',
    ...Array.from({ length: 101 }, (_, index) => `  const value${index} = ${index};`),
    '  return value100;',
    '}',
  ].join('\n');
  let failSourceForNextJob = false;
  let failNextAiRequest = false;
  let aiRequestCount = 0;
  const aiInvestigator = new GroqInvestigator({
    environment: { GROQ_API_KEY: 'test-only', GROQ_MODEL: 'test-model' },
    client: {
      async create() {
        aiRequestCount += 1;
        if (failNextAiRequest) {
          failNextAiRequest = false;
          throw new Error('test provider failure');
        }
        return {
          choices: [{
            message: {
              content: JSON.stringify({
                summary: 'Review of the persisted deterministic finding.',
                explanation: 'This advisory text is derived from the supplied evidence and is not independent confirmation.',
                attackPath: ['Inspect the source location recorded by BugZero.'],
                remediation: ['Review the deterministic finding and apply an appropriate correction.'],
                confidence: 'MEDIUM',
                reasoningStatus: 'SUPPORTED',
              }),
            },
          }],
        };
      },
    },
  });
  const processor = new AnalysisJobProcessor({
    aiInvestigator,
    sources: {
      async readCommit() {
        if (failSourceForNextJob) throw new Error('fixture source failure');
        return [{ path: 'src/long.ts', content: longFunction }];
      },
    },
  });
  const worker = createAnalysisQueueWorker(redisForWorker, (payload, attempt) => processor.process(payload, attempt));
  const api = createApiServer({ authenticate });

  try {
    await worker.waitUntilReady();
    await withOrganizationContext(organizationId, async () => {
      await pool.query(
        'INSERT INTO organizations (id, name, slug) VALUES ($1, $2, $3)',
        [organizationId, 'Live Integration Tenant A', `live-a-${organizationId.slice(0, 8)}`],
      );
    });
    await withOrganizationContext(otherOrganizationId, async () => {
      await pool.query(
        'INSERT INTO organizations (id, name, slug) VALUES ($1, $2, $3)',
        [otherOrganizationId, 'Live Integration Tenant B', `live-b-${otherOrganizationId.slice(0, 8)}`],
      );
    });
    const user = await users.create({ email: userEmail, display_name: 'Live Integration User' });
    createdUserId = user.id;
    const token = signedToken(privateKey, user.id, organizationId);
    await withOrganizationContext(organizationId, async () => {
      await members.create({ organizationId, userId: user.id, role: 'OWNER' });
    });

    const registered = await withOrganizationContext(organizationId, () =>
      repositories.createWithCommit({
        organizationId,
        provider: 'GITHUB',
        externalId: '9100091009',
        fullName: 'bugzero-live/repository',
        defaultBranch: 'main',
        cloneUrl: 'https://github.com/bugzero-live/repository.git',
        commitSha: fixtureSha,
        committedAt: new Date().toISOString(),
        indexedAt: new Date().toISOString(),
      }));

    const analysisResponse = await api.inject({
      method: 'POST',
      url: '/analysis',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        repositoryId: registered.repository.id,
        commitSha: fixtureSha,
        profileId: 'default',
        scope: 'COMMIT',
      },
    });
    assert.equal(analysisResponse.statusCode, 202, analysisResponse.body);
    const accepted = analysisResponse.json() as { analysisRunId: string; jobId: string };
    const firstResult = await waitForRun(api, token, accepted.analysisRunId, ['COMPLETED', 'FAILED', 'DEAD_LETTER']);
    assert.equal(firstResult.job?.status, 'COMPLETED');
    assert.ok(firstResult.status === 'COMPLETED' || firstResult.status === 'PARTIAL');
    const progressResponse = await api.inject({
      method: 'GET',
      url: `/analysis/${accepted.analysisRunId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(progressResponse.statusCode, 200, progressResponse.body);
    const aiProgress = progressResponse.json().progress.aiInvestigation as Record<string, unknown>;
    assert.equal(aiProgress.status, 'COMPLETED');
    assert.equal(aiProgress.completed, 1);
    assert.equal('sourceSnippets' in aiProgress, false);

    const persistedFindings = await withOrganizationContext(organizationId, () =>
      findings.getByRepository(organizationId, registered.repository.id));
    assert.ok(persistedFindings.length > 0, 'analysis must persist findings');
    const occurrenceCounts = await Promise.all(persistedFindings.map(async (finding) =>
      withOrganizationContext(organizationId, async () =>
        (await findings.getOccurrencesForFinding(organizationId, finding.id)).length)));
    const evidenceCounts = await Promise.all(persistedFindings.map(async (finding) =>
      withOrganizationContext(organizationId, async () =>
        (await evidence.getEvidenceForFinding(organizationId, finding.id)).length)));
    const riskCounts = await Promise.all(persistedFindings.map(async (finding) =>
      withOrganizationContext(organizationId, async () =>
        (await risks.getForFinding(organizationId, finding.id)).length)));
    assert.ok(occurrenceCounts.reduce((total, count) => total + count, 0) > 0);
    assert.ok(evidenceCounts.reduce((total, count) => total + count, 0) > 0);
    assert.ok(riskCounts.reduce((total, count) => total + count, 0) > 0);
    assert.ok(await withOrganizationContext(organizationId, () =>
      health.getLatest(organizationId, registered.repository.id)));

    const findingsResponse = await api.inject({
      method: 'GET',
      url: `/repositories/${registered.repository.id}/findings`,
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(findingsResponse.statusCode, 200, findingsResponse.body);
    assert.ok(findingsResponse.json().findings.length > 0);
    const detailResponse = await api.inject({
      method: 'GET',
      url: `/findings/${persistedFindings[0].id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(detailResponse.statusCode, 200, detailResponse.body);
    assert.ok(detailResponse.json().evidence);
    assert.ok(detailResponse.json().risks.length > 0);
    const initialAiInvestigations = detailResponse.json().aiInvestigations;
    assert.equal(initialAiInvestigations.length, 1);
    assert.equal(initialAiInvestigations[0].status, 'COMPLETED');
    assert.ok(initialAiInvestigations[0].result);
    assert.equal(aiRequestCount, initialAiInvestigations.length);
    if (firstResult.status !== 'COMPLETED'
      || detailResponse.json().evidence.snapshot.authority !== 'AUTHORITATIVE'
      || detailResponse.json().evidence.snapshot.sufficiency !== 'SUFFICIENT'
      || detailResponse.json().evidence.snapshot.completeness !== 'COMPLETE') {
      assert.equal(initialAiInvestigations[0].result.reasoningStatus, 'INSUFFICIENT_EVIDENCE');
    }

    const beforeReplay = {
      findings: persistedFindings.length,
      occurrences: occurrenceCounts.reduce((total, count) => total + count, 0),
      evidence: evidenceCounts.reduce((total, count) => total + count, 0),
      risks: riskCounts.reduce((total, count) => total + count, 0),
    };
    const completedQueueJob = await replayQueue.getJob(accepted.jobId);
    await completedQueueJob?.remove();
    await enqueueAnalysisJob(replayQueue, { organizationId, jobId: accepted.jobId });
    const replayDeadline = Date.now() + 60_000;
    while (Date.now() < replayDeadline) {
      const replayedQueueJob = await replayQueue.getJob(accepted.jobId);
      if (!replayedQueueJob) throw new Error('Replayed BullMQ job disappeared before completion');
      const state = await replayedQueueJob.getState();
      if (state === 'completed') break;
      if (state === 'failed') throw new Error('Replayed BullMQ job failed');
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    if (Date.now() >= replayDeadline) throw new Error('Timed out waiting for the replayed BullMQ job');
    const replayResult = await waitForRun(api, token, accepted.analysisRunId, ['COMPLETED', 'FAILED', 'DEAD_LETTER']);
    assert.equal(replayResult.job?.status, 'COMPLETED');
    const replayFindings = await withOrganizationContext(organizationId, () =>
      findings.getByRepository(organizationId, registered.repository.id));
    const replayOccurrences = await Promise.all(replayFindings.map(async (finding) =>
      withOrganizationContext(organizationId, async () =>
        (await findings.getOccurrencesForFinding(organizationId, finding.id)).length)));
    const replayEvidence = await Promise.all(replayFindings.map(async (finding) =>
      withOrganizationContext(organizationId, async () =>
        (await evidence.getEvidenceForFinding(organizationId, finding.id)).length)));
    const replayRisks = await Promise.all(replayFindings.map(async (finding) =>
      withOrganizationContext(organizationId, async () =>
        (await risks.getForFinding(organizationId, finding.id)).length)));
    assert.deepEqual({
      findings: replayFindings.length,
      occurrences: replayOccurrences.reduce((total, count) => total + count, 0),
      evidence: replayEvidence.reduce((total, count) => total + count, 0),
      risks: replayRisks.reduce((total, count) => total + count, 0),
    }, beforeReplay);
    const replayDetailResponse = await api.inject({
      method: 'GET',
      url: `/findings/${persistedFindings[0].id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(replayDetailResponse.statusCode, 200, replayDetailResponse.body);
    assert.equal(replayDetailResponse.json().aiInvestigations.length, initialAiInvestigations.length);
    assert.equal(aiRequestCount, initialAiInvestigations.length, 'replaying the same run must reuse its persisted AI result');
    const persistedAIRecords = await withOrganizationContext(organizationId, () =>
      aiInvestigationRepository.getForOccurrence(organizationId, detailResponse.json().occurrence.id));
    assert.equal(persistedAIRecords.length, initialAiInvestigations.length);

    const nextCommitSha = 'd'.repeat(40);
    await withOrganizationContext(organizationId, () => repositories.createWithCommit({
      organizationId,
      provider: 'GITHUB',
      externalId: '9100091009',
      fullName: 'bugzero-live/repository',
      defaultBranch: 'main',
      cloneUrl: 'https://github.com/bugzero-live/repository.git',
      commitSha: nextCommitSha,
      parentCommitSha: fixtureSha,
      committedAt: new Date().toISOString(),
      indexedAt: new Date().toISOString(),
    }));
    failNextAiRequest = true;
    const providerFailureResponse = await api.inject({
      method: 'POST',
      url: '/analysis',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        repositoryId: registered.repository.id,
        commitSha: nextCommitSha,
        profileId: 'default',
        scope: 'COMMIT',
      },
    });
    assert.equal(providerFailureResponse.statusCode, 202, providerFailureResponse.body);
    const providerFailureRequest = providerFailureResponse.json() as { analysisRunId: string };
    const providerFailureRun = await waitForRun(api, token, providerFailureRequest.analysisRunId, ['COMPLETED', 'PARTIAL', 'FAILED', 'DEAD_LETTER']);
    assert.equal(providerFailureRun.job?.status, 'COMPLETED');
    assert.equal(providerFailureRun.status, firstResult.status, 'Groq provider failure must not change deterministic analysis status');
    const findingsAfterProviderFailure = await withOrganizationContext(organizationId, () =>
      findings.getByRepository(organizationId, registered.repository.id));
    const providerFailureOccurrence = (await Promise.all(findingsAfterProviderFailure.map(async (finding) =>
      withOrganizationContext(organizationId, () => findings.getOccurrencesForFinding(organizationId, finding.id)))))
      .flat()
      .find((occurrence) => occurrence.analysis_run_id === providerFailureRequest.analysisRunId);
    assert.ok(providerFailureOccurrence, 'failed advisory request should retain the deterministic finding occurrence');
    const providerFailureRecords = await withOrganizationContext(organizationId, () =>
      aiInvestigationRepository.getForOccurrence(organizationId, providerFailureOccurrence.id));
    assert.equal(providerFailureRecords[0]?.status, 'FAILED');
    assert.equal(providerFailureRecords[0]?.error_code, 'PROVIDER_ERROR');

    const otherRepository = await withOrganizationContext(otherOrganizationId, async () =>
      repositories.createWithCommit({
        organizationId: otherOrganizationId,
        provider: 'GITHUB',
        externalId: '9100091010',
        fullName: 'other-tenant/private',
        defaultBranch: 'main',
        cloneUrl: 'https://github.com/other-tenant/private.git',
        commitSha: 'b'.repeat(40),
        indexedAt: new Date().toISOString(),
      }));
    const crossTenantRead = await withOrganizationContext(organizationId, async () =>
      repositories.getById(organizationId, otherRepository.repository.id));
    assert.equal(crossTenantRead, null);
    await assert.rejects(withOrganizationContext(organizationId, async () =>
      repositories.createWithCommit({
        organizationId: otherOrganizationId,
        provider: 'GITHUB',
        externalId: '9100091011',
        fullName: 'other-tenant/blocked',
        defaultBranch: 'main',
        cloneUrl: 'https://github.com/other-tenant/blocked.git',
        commitSha: 'c'.repeat(40),
        indexedAt: new Date().toISOString(),
      })));

    failSourceForNextJob = true;
    const failureResponse = await api.inject({
      method: 'POST',
      url: '/analysis',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        repositoryId: registered.repository.id,
        commitSha: fixtureSha,
        profileId: 'default',
        scope: 'COMMIT',
      },
    });
    assert.equal(failureResponse.statusCode, 202, failureResponse.body);
    const failedRun = failureResponse.json() as { analysisRunId: string; jobId: string };
    assert.notEqual(failedRun.analysisRunId, accepted.analysisRunId);
    const terminalFailure = await waitForRun(api, token, failedRun.analysisRunId, ['DEAD_LETTER', 'FAILED']);
    assert.equal(terminalFailure.job?.status, 'DEAD_LETTER');
    assert.equal(terminalFailure.status, 'FAILED');

    await withOrganizationContext(organizationId, async () => {
      await assert.rejects(repositories.createWithCommit({
        organizationId,
        provider: 'GITHUB',
        externalId: 'invalid-sha',
        fullName: 'bugzero-live/invalid',
        defaultBranch: 'main',
        cloneUrl: 'https://github.com/bugzero-live/invalid.git',
        commitSha: 'not-a-git-sha',
      }));
      assert.equal(await repositories.getByExternalId(organizationId, 'GITHUB', 'invalid-sha'), null);
    });
  } finally {
    await api.close();
    await worker.close();
    await replayQueue.close();
    await redisForWorker.quit();
    await redisForReplayQueue.quit();
    if (pool !== cleanupPool) {
      const secondaryCleaned = await cleanupTenant(cleanupPool, otherOrganizationId, null, false);
      const primaryCleaned = await cleanupTenant(cleanupPool, organizationId, createdUserId, true);
      if (!secondaryCleaned || !primaryCleaned) {
        console.info('Live integration tenant with immutable evidence retained; use a disposable database for this test');
      }
    }
    await cleanupPool.end();
  }
});
