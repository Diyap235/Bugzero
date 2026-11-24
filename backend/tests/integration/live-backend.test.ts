import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
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
import { createAnalysisQueueWorker } from '@bugzero/workers/analysis-queue';
import { AnalysisJobProcessor } from '@bugzero/workers/analysis-processor';
import { NvidiaInvestigator } from '@bugzero/workers/ai/nvidia';
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
        'data_flow_edges',
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

test('live authenticated analysis, replay, readback, retries, and tenant RLS', { skip: !enabled }, async (t) => {
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL must target the live PostgreSQL test database');

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

  await t.test('live local SQL injection analysis persists finding, evidence, risk, and independently verified health', { skip: !enabled }, async () => {
    assert.ok(process.env.DATABASE_URL, 'DATABASE_URL must target the live PostgreSQL test database');

    const pool = getDatabasePool();
    const cleanupPool = createDatabasePool({ connectionString: process.env.DATABASE_URL, max: 2 });
    const organizationId = crypto.randomUUID();
    const userEmail = `live-sqli-${crypto.randomUUID()}@bugzero.invalid`;
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
    const findings = new FindingRepository(pool);
    const evidence = new EvidenceRepository(pool);
    const risks = new RiskAssessmentRepository(pool);
    const health = new HealthRepository(pool);
    const source = await import('node:fs/promises').then(({ readFile }) =>
      readFile(new URL('../../../bugzero-50-file-audit-fixture/cases/case_017_ts_sqli_concat.ts', import.meta.url), 'utf8'));
    const sourceBytes = Buffer.from(source, 'utf8');
    const contentSha256 = createHash('sha256').update(sourceBytes).digest('hex');
    const commitSha = contentSha256.slice(0, 40);
    const processor = new AnalysisJobProcessor();
    const worker = createAnalysisQueueWorker(
      (payload, attempt) => processor.process(payload, attempt),
    );
    const api = createApiServer({ authenticate });

    try {
      void worker.run();
      await withOrganizationContext(organizationId, async () => {
        await pool.query(
          'INSERT INTO organizations (id, name, slug) VALUES ($1, $2, $3)',
          [organizationId, 'Live SQL Injection Verification', `live-sqli-${organizationId.slice(0, 8)}`],
        );
      });
      const user = await users.create({ email: userEmail, display_name: 'Live SQL Injection Verification' });
      createdUserId = user.id;
      const token = signedToken(privateKey, user.id, organizationId);
      await withOrganizationContext(organizationId, () =>
        members.create({ organizationId, userId: user.id, role: 'OWNER' }));

      const registered = await withOrganizationContext(organizationId, () =>
        repositories.createWithCommitAndFiles({
          organizationId,
          provider: 'LOCAL',
          externalId: `live-sqli-${organizationId}`,
          fullName: 'bugzero-live/sql-injection-fallback',
          defaultBranch: 'main',
          cloneUrl: 'local://bugzero-live/sql-injection-fallback',
          commitSha,
          committedAt: new Date().toISOString(),
          indexedAt: new Date().toISOString(),
          files: [{
            path: 'src/app.ts',
            contentSha256,
            sizeBytes: sourceBytes.length,
            language: 'TypeScript',
            sourceContent: source,
          }],
        }));

      const acceptedResponse = await api.inject({
        method: 'POST',
        url: '/analysis',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          repositoryId: registered.repository.id,
          commitSha,
          profileId: 'default',
          scope: 'COMMIT',
        },
      });
      assert.equal(acceptedResponse.statusCode, 202, acceptedResponse.body);
      const accepted = acceptedResponse.json() as { analysisRunId: string };
      const run = await waitForRun(api, token, accepted.analysisRunId, ['COMPLETED', 'PARTIAL', 'FAILED', 'DEAD_LETTER']);
      assert.equal(run.status, 'COMPLETED');
      assert.equal(run.job?.status, 'COMPLETED');

      const ir = await withOrganizationContext(organizationId, () =>
        pool.query<{ entities: string; relationships: string }>(
          `SELECT
             (SELECT count(*) FROM code_entities WHERE organization_id = $1 AND repository_id = $2 AND commit_id = $3) AS entities,
             (SELECT count(*) FROM code_relationships WHERE organization_id = $1 AND repository_id = $2 AND commit_id = $3) AS relationships`,
          [organizationId, registered.repository.id, registered.commit.id],
        ));
      assert.ok(Number(ir.rows[0]?.entities) > 0, 'parsing must persist Code IR entities');
      assert.ok(Number(ir.rows[0]?.relationships) > 0, 'parsing must persist Code IR relationships');

      const repositoryFindings = await withOrganizationContext(organizationId, () =>
        findings.getByRepository(organizationId, registered.repository.id));
      const runOccurrences = (await Promise.all(repositoryFindings.map(async (finding) =>
        withOrganizationContext(organizationId, () => findings.getOccurrencesForFinding(organizationId, finding.id)))))
        .flat()
        .filter((occurrence) => occurrence.analysis_run_id === accepted.analysisRunId);
      const sqlFinding = repositoryFindings.find((finding) =>
        finding.rule_id === 'SECURITY.SQL_INJECTION'
        && runOccurrences.some((occurrence) => occurrence.finding_id === finding.id));
      assert.ok(sqlFinding, 'the real TypeScript ?? source must produce a deterministic SQL injection finding');
      const occurrence = runOccurrences.find((item) => item.finding_id === sqlFinding.id);
      assert.ok(occurrence);
      const evidenceRecords = await withOrganizationContext(organizationId, () =>
        evidence.getEvidenceForFinding(organizationId, sqlFinding.id));
      const persistedEvidence = evidenceRecords.find((item) =>
        item.analysis_run_id === accepted.analysisRunId && item.finding_occurrence_id === occurrence.id);
      assert.ok(persistedEvidence, 'the finding must have a persisted evidence snapshot');
      const persistedGraph = await withOrganizationContext(organizationId, () =>
        evidence.getSnapshot(organizationId, persistedEvidence.id));
      assert.ok(persistedGraph?.nodes.some((node) => node.node_type === 'SOURCE'));
      assert.ok(persistedGraph?.nodes.some((node) => node.node_type === 'SINK'));

      const riskRecords = await withOrganizationContext(organizationId, () =>
        risks.getForFinding(organizationId, sqlFinding.id));
      const persistedRisk = riskRecords.find((item) =>
        item.analysis_run_id === accepted.analysisRunId && item.finding_occurrence_id === occurrence.id);
      assert.ok(persistedRisk, 'the deterministic Risk Assessment must be persisted');
      const riskProfile = persistedRisk.profile_snapshot;
      const severityBase = riskProfile.severityBase as Record<string, number>;
      const riskAdjustments = riskProfile.adjustments as Record<string, Record<string, number>>;
      const riskFactors = [
        ['confidence', persistedRisk.confidence],
        ['evidenceStrength', persistedRisk.evidence_strength],
        ['evidenceAuthority', persistedRisk.evidence_authority],
        ['evidenceSufficiency', persistedRisk.evidence_sufficiency],
        ['evidenceCompleteness', persistedRisk.evidence_completeness],
        ['reachability', persistedRisk.reachability],
        ['exploitability', persistedRisk.exploitability],
      ] as const;
      const recalculatedRisk = Math.max(0, Math.min(100,
        severityBase[persistedRisk.severity]
        + riskFactors.reduce((total, [factor, value]) => total + riskAdjustments[factor][value], 0)));
      assert.equal(recalculatedRisk, persistedRisk.technical_risk);

      const persistedHealth = await withOrganizationContext(organizationId, () =>
        health.getForRun(organizationId, registered.repository.id, accepted.analysisRunId));
      assert.ok(persistedHealth, 'the run must persist a Health snapshot');
      const healthProfile = persistedHealth.profile_snapshot;
      assert.ok(healthProfile);
      const dimensions = persistedHealth.dimensions as Record<string, {
        score: number | null;
        inputMetrics: {
          findingCount: number;
          severityCounts: Record<string, number>;
          totalTechnicalRisk: number;
        };
      }>;
      const healthWeights = healthProfile.dimensionWeights as Record<string, number>;
      const penalties = healthProfile.severityPenalty as Record<string, Record<string, number>>;
      const riskScale = healthProfile.riskScale as number;
      const recalculatedDimensions: Array<{ score: number; weight: number }> = [];
      for (const name of ['security', 'quality', 'maintainability']) {
        const dimension = dimensions[name];
        assert.ok(dimension);
        if (dimension.score === null) continue;
        const severityPenalty = Object.entries(dimension.inputMetrics.severityCounts)
          .reduce((sum, [severity, count]) => {
            if (count === 0) return sum;
            const penalty = penalties[name]?.[severity];
            assert.equal(typeof penalty, 'number', `missing ${name} penalty for ${severity}`);
            return sum + penalty * count * dimension.inputMetrics.totalTechnicalRisk
              / dimension.inputMetrics.findingCount / riskScale;
          }, 0);
        const recalculatedDimension = Math.max(0, Math.min(100, Math.round(100 - severityPenalty)));
        assert.equal(recalculatedDimension, dimension.score);
        if (healthWeights[name] > 0) recalculatedDimensions.push({ score: recalculatedDimension, weight: healthWeights[name] });
      }
      const recalculatedHealth = Math.round(
        recalculatedDimensions.reduce((sum, dimension) => sum + dimension.score * dimension.weight, 0)
        / recalculatedDimensions.reduce((sum, dimension) => sum + dimension.weight, 0),
      );
      assert.equal(recalculatedHealth, persistedHealth.overall_score);

      const findingResponse = await api.inject({
        method: 'GET',
        url: `/findings/${sqlFinding.id}`,
        headers: { authorization: `Bearer ${token}` },
      });
      assert.equal(findingResponse.statusCode, 200, findingResponse.body);
      const apiRisk = (findingResponse.json() as { risks: Array<{ id: string; technical_risk: number }> })
        .risks.find((item) => item.id === persistedRisk.id);
      assert.ok(apiRisk, 'authenticated finding API must return the persisted Risk Assessment');
      assert.equal(Number(apiRisk.technical_risk), persistedRisk.technical_risk);
      assert.equal(Number(apiRisk.technical_risk), recalculatedRisk);

      const healthResponse = await api.inject({
        method: 'GET',
        url: `/repositories/${registered.repository.id}/health`,
        headers: { authorization: `Bearer ${token}` },
      });
      assert.equal(healthResponse.statusCode, 200, healthResponse.body);
      const apiHealth = (healthResponse.json() as { history: Array<{ snapshot: { id: string; overall_score: number | null } }> })
        .history.find((item) => item.snapshot.id === persistedHealth.id)?.snapshot;
      assert.ok(apiHealth);
      assert.equal(apiHealth.overall_score, persistedHealth.overall_score);
      assert.equal(apiHealth.overall_score, recalculatedHealth);
    } finally {
      await api.close();
      await worker.close();
      const cleaned = await cleanupTenant(cleanupPool, organizationId, createdUserId, true);
      if (!cleaned) {
        console.info('Live SQL injection verification tenant with immutable evidence retained; use a disposable database for this test');
      }
      await cleanupPool.end();
    }
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
  const longFunction = [
    'export function deliberatelyLongFunction() {',
    ...Array.from({ length: 101 }, (_, index) => `  const value${index} = ${index};`),
    '  return value100;',
    '}',
  ].join('\n');
  let failSourceForNextJob = false;
  let failNextAiRequest = false;
  let aiRequestCount = 0;
  let repositoryReviewCount = 0;
  const aiRequestRuleIds: string[] = [];
  const aiInvestigator = new NvidiaInvestigator({
    environment: { NVIDIA_API_KEY: 'test-only', NVIDIA_MODEL: 'test-model' },
    client: {
      async create(input) {
        const userMessage = input.messages.find((message) => message.role === 'user')?.content;
        assert.ok(userMessage);
        if (userMessage.startsWith('<BUGZERO_REPOSITORY>\n')) {
          repositoryReviewCount += 1;
          const reference = { filePath: 'src/long.ts', line: 1 };
          return {
            choices: [{
              message: {
                content: JSON.stringify({
                  dimensions: {
                    SECURITY: { score: 82, confidence: 'MEDIUM', explanation: 'Source reviewed.', evidence: [reference] },
                    QUALITY: { score: 79, confidence: 'MEDIUM', explanation: 'Source reviewed.', evidence: [reference] },
                    MAINTAINABILITY: { score: 76, confidence: 'LOW', explanation: 'Source reviewed.', evidence: [reference] },
                    RELIABILITY: { score: 72, confidence: 'LOW', explanation: 'Source reviewed.', evidence: [reference] },
                    DEPENDENCIES: { score: 60, confidence: 'LOW', explanation: 'No manifest evidence.', evidence: [] },
                  },
                  findings: [],
                }),
              },
            }],
          };
        }
        aiRequestCount += 1;
        const serializedContext = /^<BUGZERO_EVIDENCE>\n([\s\S]*)\n<\/BUGZERO_EVIDENCE>$/.exec(userMessage);
        assert.ok(serializedContext);
        const investigationContext = JSON.parse(serializedContext[1]) as { finding: { ruleId: string } };
        aiRequestRuleIds.push(investigationContext.finding.ruleId);
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
  const worker = createAnalysisQueueWorker(
    (payload, attempt) => processor.process(payload, attempt),
  );
  const api = createApiServer({ authenticate });

  try {
    await withOrganizationContext(organizationId, async () => {
      await pool.query(
        'INSERT INTO organizations (id, name, slug) VALUES ($1, $2, $3)',
        [organizationId, 'Live Integration Tenant A', `live-a-${organizationId.slice(0, 8)}`],
      );
    });
    void worker.run();
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
    assert.equal('sourceSnippets' in aiProgress, false);

    const persistedFindings = await withOrganizationContext(organizationId, () =>
      findings.getByRepository(organizationId, registered.repository.id));
    const runOccurrences = (await Promise.all(persistedFindings.map(async (finding) =>
      withOrganizationContext(organizationId, () =>
        findings.getOccurrencesForFinding(organizationId, finding.id)))))
      .flat()
      .filter((occurrence) => occurrence.analysis_run_id === accepted.analysisRunId);
    const uniqueRunOccurrences = runOccurrences.filter((occurrence, index, allOccurrences) =>
      allOccurrences.findIndex((candidate) => candidate.finding_id === occurrence.finding_id) === index);
    assert.equal(aiProgress.completed, uniqueRunOccurrences.length,
      'progress must count one completed investigation per distinct persisted finding, not assume a single finding');
    const initialRunInvestigations = (await Promise.all(uniqueRunOccurrences.map((occurrence) =>
      withOrganizationContext(organizationId, () =>
        aiInvestigationRepository.getForOccurrence(organizationId, occurrence.id)))))
      .flat();
    const expectedAiRequestRuleIds = uniqueRunOccurrences.map((occurrence) => {
      const runFinding = persistedFindings.find((finding) => finding.id === occurrence.finding_id);
      assert.ok(runFinding);
      return runFinding.rule_id;
    });
    assert.equal(aiRequestCount, uniqueRunOccurrences.length,
      'each distinct finding in the run should receive one AI investigation');
    assert.deepEqual([...aiRequestRuleIds].sort(), [...expectedAiRequestRuleIds].sort(),
      'the AI calls should correspond to distinct persisted finding rules');
    assert.equal(initialRunInvestigations.length, uniqueRunOccurrences.length,
      'each distinct finding should have one persisted AI investigation');
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
    const persistedHealth = await withOrganizationContext(organizationId, () =>
      health.getForRun(organizationId, registered.repository.id, accepted.analysisRunId));
    assert.ok(persistedHealth, 'analysis must persist a health snapshot for this run');
    const persistedRiskAssessments = (await Promise.all(persistedFindings.map(async (finding) =>
      withOrganizationContext(organizationId, () => risks.getForFinding(organizationId, finding.id)))))
      .flat()
      .filter((assessment) => assessment.analysis_run_id === accepted.analysisRunId);
    assert.ok(persistedRiskAssessments.length > 0, 'analysis must persist a risk assessment for this run');

    const persistedRisk = persistedRiskAssessments[0];
    assert.ok(persistedRisk);
    const riskSeverityBase = persistedRisk.profile_snapshot.severityBase as Record<string, number>;
    const riskAdjustments = persistedRisk.profile_snapshot.adjustments as Record<string, Record<string, number>>;
    const riskInputs = [
      ['confidence', persistedRisk.confidence],
      ['evidenceStrength', persistedRisk.evidence_strength],
      ['evidenceAuthority', persistedRisk.evidence_authority],
      ['evidenceSufficiency', persistedRisk.evidence_sufficiency],
      ['evidenceCompleteness', persistedRisk.evidence_completeness],
      ['reachability', persistedRisk.reachability],
      ['exploitability', persistedRisk.exploitability],
    ] as const;
    const independentRiskScore = Math.max(0, Math.min(100,
      riskSeverityBase[persistedRisk.severity]
      + riskInputs.reduce((total, [dimension, value]) => total + riskAdjustments[dimension][value], 0)));
    assert.equal(independentRiskScore, persistedRisk.technical_risk);

    type PersistedHealthDimension = {
      score: number | null;
      inputMetrics: {
        findingCount: number;
        severityCounts: Record<string, number>;
        totalTechnicalRisk: number;
      };
    };
    const healthDimensions = persistedHealth.dimensions as Record<string, PersistedHealthDimension>;
    assert.ok(persistedHealth.profile_snapshot);
    const healthProfile = persistedHealth.profile_snapshot;
    const severityPenalties = healthProfile.severityPenalty as Record<string, Record<string, number>>;
    const healthWeights = healthProfile.dimensionWeights as Record<string, number>;
    const riskScale = healthProfile.riskScale as number;
    const independentlyScoredDimensions: Array<{ score: number; weight: number }> = [];
    for (const name of ['security', 'quality', 'maintainability']) {
      const dimension = healthDimensions[name];
      assert.ok(dimension);
      if (dimension.inputMetrics.findingCount === 0) {
        assert.equal(dimension.score, 100);
      } else {
        assert.equal(dimension.inputMetrics.findingCount, 1, 'controlled fixture should have one finding per scored dimension');
        const severity = Object.entries(dimension.inputMetrics.severityCounts)
          .find(([, count]) => count === 1)?.[0];
        assert.ok(severity);
        const penalty = severityPenalties[name][severity] * dimension.inputMetrics.totalTechnicalRisk / riskScale;
        const independentDimensionScore = Math.max(0, Math.min(100, Math.round(100 - penalty)));
        assert.equal(independentDimensionScore, dimension.score);
      }
      if (dimension.score !== null && healthWeights[name] > 0) {
        independentlyScoredDimensions.push({ score: dimension.score, weight: healthWeights[name] });
      }
    }
    const independentHealthScore = Math.round(
      independentlyScoredDimensions.reduce((total, dimension) => total + dimension.score * dimension.weight, 0)
      / independentlyScoredDimensions.reduce((total, dimension) => total + dimension.weight, 0),
    );
    assert.equal(independentHealthScore, Number(persistedHealth.overall_score));

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
    const apiRisk = detailResponse.json().risks.find((assessment: { id: string }) =>
      assessment.id === persistedRisk.id);
    assert.ok(apiRisk);
    assert.equal(Number(apiRisk.technical_risk), persistedRisk.technical_risk);
    const repositoryResponse = await api.inject({
      method: 'GET',
      url: `/repositories/${registered.repository.id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(repositoryResponse.statusCode, 200, repositoryResponse.body);
    const apiHealth = repositoryResponse.json().latestHealth as {
      id: string;
      overall_score: number | string;
      dimensions: Record<string, { estimatedScore?: number | null }>;
      calculation: Record<string, unknown>;
    } | null;
    assert.ok(apiHealth);
    assert.equal(apiHealth.id, persistedHealth.id);
    assert.equal(Number(apiHealth.overall_score), Number(persistedHealth.overall_score));
    assert.equal(apiHealth.dimensions.security?.estimatedScore, 82);
    assert.equal(apiHealth.dimensions.dependencies?.estimatedScore, null);
    assert.equal(typeof apiHealth.calculation.aiEstimatedOverallScore, 'number');
    const initialAiInvestigations = detailResponse.json().aiInvestigations;
    assert.equal(initialAiInvestigations.length, 1);
    assert.equal(initialAiInvestigations[0].status, 'COMPLETED');
    assert.ok(initialAiInvestigations[0].result);
    assert.equal('provider' in initialAiInvestigations[0], false);
    assert.equal('model' in initialAiInvestigations[0], false);
    assert.equal('provider' in detailResponse.json().aiExplanation, false);
    assert.equal('model' in detailResponse.json().aiExplanation, false);
    assert.equal(aiRequestCount, initialRunInvestigations.length,
      'the mock request count is run-wide, while this detail endpoint returns one finding');
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
    await withOrganizationContext(organizationId, async () => {
      await analyses.updateJobStatus(organizationId, accepted.jobId, 'RETRY');
      await analyses.updateRunStatus(organizationId, accepted.analysisRunId, 'RUNNING', {});
    });
    const replayDeadline = Date.now() + 60_000;
    while (Date.now() < replayDeadline) {
      const replayedJob = await withOrganizationContext(organizationId, () =>
        analyses.getJob(organizationId, accepted.jobId));
      if (replayedJob?.status === 'COMPLETED') break;
      if (replayedJob?.status === 'DEAD_LETTER' || replayedJob?.status === 'FAILED') {
        throw new Error('Replayed PostgreSQL queue job failed');
      }
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    if (Date.now() >= replayDeadline) throw new Error('Timed out waiting for the replayed PostgreSQL queue job');
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
    assert.equal(aiRequestCount, initialRunInvestigations.length, 'replaying the same run must reuse its persisted AI results');
    assert.ok(repositoryReviewCount >= 2, 'repository-level source review should run once for each analysis');
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
    assert.equal(providerFailureRun.status, firstResult.status, 'advisory service failure must not change deterministic analysis status');
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
    const activeDatabaseRole = await withOrganizationContext(organizationId, () =>
      pool.query<{ rolbypassrls: boolean }>(
        'SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user',
      ));
    assert.equal(activeDatabaseRole.rows[0]?.rolbypassrls, true,
      'this test must exercise repository guards with an RLS-bypassing database role');
    await assert.rejects(
      repositories.getById(otherOrganizationId, otherRepository.repository.id),
      /active organization context/,
      'repository reads without tenant context must be rejected before querying the database',
    );
    await assert.rejects(
      withOrganizationContext(organizationId, () =>
        repositories.getById(otherOrganizationId, otherRepository.repository.id)),
      /does not match the active organization context/,
      'a tenant context cannot be used to read another tenant by supplying its organization ID',
    );
    const crossTenantRead = await withOrganizationContext(organizationId, async () =>
      repositories.getById(organizationId, otherRepository.repository.id));
    assert.equal(crossTenantRead, null);
    await assert.rejects(
      repositories.createWithCommit({
        organizationId,
        provider: 'GITHUB',
        externalId: '9100091012',
        fullName: 'bugzero-live/no-context-write',
        defaultBranch: 'main',
        cloneUrl: 'https://github.com/bugzero-live/no-context-write.git',
        commitSha: 'e'.repeat(40),
      }),
      /active organization context/,
      'repository writes without tenant context must be rejected',
    );
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
