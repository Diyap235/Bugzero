import test from 'node:test';
import assert from 'node:assert/strict';
import type {
  AnalysisRun,
  Finding,
  FindingOccurrence,
  HealthSnapshot,
  ReportRecord,
  RepositoryCommit,
  RepositoryRecord,
  RiskAssessmentRecord,
} from '@bugzero/database';
import { createApiServer } from '../../src/server.js';

const organizationId = '11111111-1111-4111-8111-111111111111';
const repositoryId = '22222222-2222-4222-8222-222222222222';
const userId = '33333333-3333-4333-8333-333333333333';

const repository: RepositoryRecord = {
  id: repositoryId,
  organization_id: organizationId,
  provider: 'GITHUB',
  external_id: 'repo-1',
  full_name: 'example/repository',
  default_branch: 'main',
  clone_url: 'https://github.com/example/repository.git',
  created_at: new Date(0).toISOString(),
  updated_at: new Date(0).toISOString(),
};

const report: ReportRecord = {
  id: '44444444-4444-4444-8444-444444444444',
  organization_id: organizationId,
  repository_id: repositoryId,
  analysis_run_id: '55555555-5555-4555-8555-555555555555',
  created_by_user_id: userId,
  format: 'JSON',
  object_key: 'internal/report.json',
  metadata: { title: 'Analysis summary' },
  created_at: new Date(0).toISOString(),
};

test('GET repository reports returns the typed tenant-scoped report summary', async () => {
  const app = createApiServer({
    async authenticate() {
      return { organizationId, userId };
    },
    product: {
      members: {
        async getMembership() {
          return {
            id: 'member',
            organization_id: organizationId,
            user_id: userId,
            role: 'VIEWER',
            created_at: '',
            updated_at: '',
          };
        },
      },
      repositories: {
        async getById(requestedOrganizationId, requestedRepositoryId) {
          return requestedOrganizationId === organizationId && requestedRepositoryId === repositoryId
            ? repository
            : null;
        },
        async listByOrganization() {
          return [repository];
        },
      },
      reports: {
        async listByRepository(requestedOrganizationId, requestedRepositoryId) {
          assert.equal(requestedOrganizationId, organizationId);
          assert.equal(requestedRepositoryId, repositoryId);
          return [report];
        },
      },
    },
  });

  try {
    const response = await app.inject({ method: 'GET', url: `/repositories/${repositoryId}/reports` });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), {
      reports: [{
        id: report.id,
        organizationId,
        repositoryId,
        analysisRunId: report.analysis_run_id,
        createdByUserId: userId,
        format: 'JSON',
        metadata: { title: 'Analysis summary' },
        createdAt: new Date(0).toISOString(),
      }],
    });
    assert.equal(response.body.includes(report.object_key ?? ''), false);
  } finally {
    await app.close();
  }
});

test('GET repository health returns the persisted SQL-injection assessment for its completed run', async () => {
  const firstRunId = '55555555-5555-4555-8555-555555555555';
  const repeatedRunId = '66666666-6666-4666-8666-666666666666';
  const commitId = '77777777-7777-4777-8777-777777777777';
  const findingId = '88888888-8888-4888-8888-888888888888';
  const occurrenceId = '99999999-9999-4999-8999-999999999999';
  const now = new Date(0).toISOString();
  const runs: AnalysisRun[] = [repeatedRunId, firstRunId].map((id) => ({
    id,
    organization_id: organizationId,
    repository_id: repositoryId,
    commit_id: commitId,
    profile_id: 'default-v1',
    profile_version: '1',
    scope: 'COMMIT',
    status: id === repeatedRunId ? 'PARTIAL' : 'COMPLETED',
    coverage: {},
    created_at: now,
    started_at: now,
    completed_at: now,
  }));
  const commit: RepositoryCommit = {
    id: commitId,
    organization_id: organizationId,
    repository_id: repositoryId,
    commit_sha: 'a'.repeat(40),
    parent_commit_sha: null,
    committed_at: now,
    indexed_at: now,
    created_at: now,
  };
  const finding: Finding = {
    id: findingId,
    organization_id: organizationId,
    repository_id: repositoryId,
    rule_id: 'SECURITY.SQL_INJECTION',
    identity_fingerprint: 'finding-fingerprint',
    identity_version: '1',
    lifecycle: 'OPEN',
    current_occurrence_id: occurrenceId,
    resolution_evidence_id: null,
    current_severity: 'HIGH',
    current_confidence: 'HIGH',
    current_risk: '80.00',
    last_seen_commit_id: commitId,
    business_priority: null,
    accepted_risk: false,
    exception_id: null,
    disposition_reason: null,
    created_at: now,
    updated_at: now,
  };
  const occurrence: FindingOccurrence = {
    id: occurrenceId,
    organization_id: organizationId,
    finding_id: findingId,
    repository_id: repositoryId,
    commit_id: commitId,
    analysis_run_id: firstRunId,
    rule_id: finding.rule_id,
    semantic_target_id: 'db.query',
    normalized_fingerprint: 'occurrence-fingerprint',
    relationship_fingerprint: null,
    file_path: 'src/vulnerable.ts',
    start_line: 5,
    end_line: 5,
    observation: 'DETECTED',
    severity: 'HIGH',
    confidence: 'HIGH',
    evidence_strength: 'HIGH',
    exploitability: 'HIGH',
    reachability: 'HIGH',
    technical_risk: 80,
    resolution: 'EXACT',
    match_result: 'SAME',
    created_at: now,
  };
  const repeatedOccurrence: FindingOccurrence = {
    ...occurrence,
    id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    analysis_run_id: repeatedRunId,
    technical_risk: 65,
  };
  const risk: RiskAssessmentRecord = {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    organization_id: organizationId,
    finding_id: findingId,
    finding_occurrence_id: occurrenceId,
    evidence_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    repository_id: repositoryId,
    commit_id: commitId,
    analysis_run_id: firstRunId,
    profile_id: 'default-v1',
    profile_version: 1,
    model_version: '1',
    severity: 'HIGH',
    confidence: 'HIGH',
    evidence_strength: 'HIGH',
    evidence_authority: 'AUTHORITATIVE',
    evidence_sufficiency: 'SUFFICIENT',
    evidence_completeness: 'COMPLETE',
    reachability: 'HIGH',
    exploitability: 'HIGH',
    dependency_exposure: 'UNKNOWN',
    affected_module_count: null,
    technical_risk: 80,
    risk_band: 'HIGH',
    profile_snapshot: {},
    factors: {},
    calculation: {},
    explanation: 'Persisted risk assessment',
    assessed_at: now,
  };
  const repeatedRisk: RiskAssessmentRecord = {
    ...risk,
    id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
    finding_occurrence_id: repeatedOccurrence.id,
    evidence_id: 'abababab-abab-4bab-8bab-abababababab',
    analysis_run_id: repeatedRunId,
    technical_risk: 65,
  };
  const healthSnapshot: HealthSnapshot = {
    id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    organization_id: organizationId,
    repository_id: repositoryId,
    commit_id: commitId,
    analysis_run_id: firstRunId,
    profile_id: 'default-v1',
    profile_version: 1,
    model_version: '1',
    overall_score: 91,
    overall_status: 'EXCELLENT',
    coverage: 'PARTIAL',
    dimensions: {
      security: {
        score: 84,
        status: 'GOOD',
        coverage: 'COMPLETE',
        confidence: 100,
        inputMetrics: {},
        explanation: 'Verified deterministic score.',
        estimatedScore: 55,
        estimateConfidence: 'HIGH',
        estimateExplanation: 'Cited advisory estimate.',
        estimateCoverage: {
          sourceFilesProvided: 2,
          sourceFilesAvailable: 4,
          sourceCoveragePercent: 50,
          dependencyManifestsProvided: 1,
        },
        estimateEvidence: [{ filePath: 'src/app.py', line: 4 }],
      },
      quality: { score: null, status: 'UNKNOWN', coverage: 'UNKNOWN', confidence: null, inputMetrics: {}, explanation: 'Unknown.' },
      maintainability: { score: null, status: 'UNKNOWN', coverage: 'UNKNOWN', confidence: null, inputMetrics: {}, explanation: 'Unknown.' },
      reliability: { score: null, status: 'UNKNOWN', coverage: 'UNKNOWN', confidence: null, inputMetrics: {}, explanation: 'Unknown.' },
      dependencies: { score: null, status: 'UNKNOWN', coverage: 'UNKNOWN', confidence: null, inputMetrics: {}, explanation: 'Unknown.' },
    },
    profile_snapshot: {},
    calculation: {
      aiReview: { status: 'COMPLETED', errorCode: null, providerStatus: null },
      sourceFileCoverage: { parsedFileCount: 4, sourceFileCount: 4, coveragePercent: 100 },
    },
    explanation: 'Persisted health snapshot',
    security_score: 84,
    quality_score: 100,
    reliability_score: null,
    maintainability_score: 100,
    dependency_score: null,
    created_at: now,
  };
  const latestRunHealthSnapshot: HealthSnapshot = {
    ...healthSnapshot,
    id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    analysis_run_id: repeatedRunId,
    overall_score: 76,
    security_score: 65,
    explanation: 'Second run health assessment',
  };
  const app = createApiServer({
    async authenticate() {
      return { organizationId, userId };
    },
    product: {
      members: {
        async getMembership() {
          return {
            id: 'member',
            organization_id: organizationId,
            user_id: userId,
            role: 'VIEWER',
            created_at: now,
            updated_at: now,
          };
        },
      },
      repositories: {
        async getById() {
          return repository;
        },
        async listByOrganization() {
          return [repository];
        },
      },
      commits: {
        async getLatest() {
          return commit;
        },
        async getById() {
          return commit;
        },
      },
      analysis: {
        async listRunsByRepository() {
          return runs;
        },
        async getLatestJobForRun() {
          return null;
        },
      },
      findings: {
        async getById() {
          return finding;
        },
        async getByRepository() {
          return [finding];
        },
        async getOccurrencesForFinding() {
          return [occurrence, repeatedOccurrence];
        },
      },
      risks: {
        async getForFinding() {
          return [risk, repeatedRisk];
        },
      },
      health: {
        async getForRun(_organizationId, _repositoryId, analysisRunId) {
          assert.equal(analysisRunId, repeatedRunId);
          return latestRunHealthSnapshot;
        },
        async listByRepository() {
          return [latestRunHealthSnapshot, healthSnapshot];
        },
      },
    },
  });

  try {
    const overviewResponse = await app.inject({ method: 'GET', url: `/repositories/${repositoryId}` });
    assert.equal(overviewResponse.statusCode, 200);
    const overview = overviewResponse.json() as {
      latestRun: { id: string };
      latestHealth: HealthSnapshot;
    };
    assert.equal(overview.latestRun.id, repeatedRunId);
    assert.equal(overview.latestHealth.analysis_run_id, repeatedRunId);
    assert.equal(overview.latestHealth.overall_score, 76);

    const response = await app.inject({ method: 'GET', url: `/repositories/${repositoryId}/history` });
    assert.equal(response.statusCode, 200);
    const history = response.json().history as Array<{
      findingCount: number;
      totalTechnicalRisk: number;
      healthScore: number | null;
    }>;
    assert.deepEqual(history.map(({ findingCount, totalTechnicalRisk, healthScore }) =>
      ({ findingCount, totalTechnicalRisk, healthScore })), [
      { findingCount: 1, totalTechnicalRisk: 65, healthScore: 76 },
      { findingCount: 1, totalTechnicalRisk: 80, healthScore: 91 },
    ]);

    const findingsResponse = await app.inject({
      method: 'GET',
      url: `/repositories/${repositoryId}/findings`,
    });
    assert.equal(findingsResponse.statusCode, 200);
    const listedFinding = findingsResponse.json().findings[0].finding as { currentRisk: unknown };
    assert.equal(listedFinding.currentRisk, 80);
    assert.equal(typeof listedFinding.currentRisk, 'number');

    const healthResponse = await app.inject({ method: 'GET', url: `/repositories/${repositoryId}/health` });
    assert.equal(healthResponse.statusCode, 200);
    const healthHistory = healthResponse.json().history as Array<{
      snapshot: {
        repository_id: string;
        commit_id: string;
        analysis_run_id: string;
        overall_score: number | null;
        coverage: string | null;
        security_score: number | null;
        dimensions: Record<string, unknown>;
        calculation: Record<string, unknown>;
      };
      analysisRunStatus: string | null;
    }>;
    assert.deepEqual(healthHistory.map(({ snapshot: item, analysisRunStatus }) => ({
      analysisRunId: item.analysis_run_id,
      analysisRunStatus,
    })), [
      { analysisRunId: repeatedRunId, analysisRunStatus: 'PARTIAL' },
      { analysisRunId: firstRunId, analysisRunStatus: 'COMPLETED' },
    ]);
    const completedRunHealth = healthHistory[1];
    assert.ok(completedRunHealth);
    assert.equal(finding.rule_id, 'SECURITY.SQL_INJECTION');
    assert.equal(occurrence.analysis_run_id, completedRunHealth.snapshot.analysis_run_id);
    assert.equal(completedRunHealth.snapshot.repository_id, finding.repository_id);
    assert.equal(completedRunHealth.snapshot.commit_id, occurrence.commit_id);
    assert.equal(completedRunHealth.snapshot.overall_score, healthSnapshot.overall_score);
    assert.equal(completedRunHealth.snapshot.security_score, healthSnapshot.security_score);
    assert.equal(completedRunHealth.snapshot.coverage, healthSnapshot.coverage);
    const securityDimension = completedRunHealth.snapshot.dimensions.security as {
      score: number | null;
      estimatedScore: number | null;
      estimateConfidence: string;
      estimateCoverage: {
        sourceFilesProvided: number;
        sourceFilesAvailable: number;
        sourceCoveragePercent: number;
        dependencyManifestsProvided: number;
      };
    };
    assert.equal(securityDimension.score, 84);
    assert.equal(securityDimension.estimatedScore, 55);
    assert.equal(securityDimension.estimateConfidence, 'HIGH');
    assert.deepEqual(securityDimension.estimateCoverage, {
      sourceFilesProvided: 2,
      sourceFilesAvailable: 4,
      sourceCoveragePercent: 50,
      dependencyManifestsProvided: 1,
    });
    assert.deepEqual(completedRunHealth.snapshot.calculation.sourceFileCoverage, {
      parsedFileCount: 4,
      sourceFileCount: 4,
      coveragePercent: 100,
    });
  } finally {
    await app.close();
  }
});

test('GET repository findings batches occurrence and revision lookups', async () => {
  const now = new Date(0).toISOString();
  const findingId = '88888888-8888-4888-8888-888888888888';
  const occurrenceId = '99999999-9999-4999-8999-999999999999';
  const commitId = '77777777-7777-4777-8777-777777777777';
  const sha = 'a'.repeat(40);
  const finding: Finding = {
    id: findingId,
    organization_id: organizationId,
    repository_id: repositoryId,
    rule_id: 'SECURITY.SQL_INJECTION',
    identity_fingerprint: 'finding-fingerprint',
    identity_version: '1',
    lifecycle: 'OPEN',
    current_occurrence_id: occurrenceId,
    resolution_evidence_id: null,
    current_severity: 'HIGH',
    current_confidence: 'HIGH',
    current_risk: 80,
    last_seen_commit_id: commitId,
    business_priority: null,
    accepted_risk: false,
    exception_id: null,
    disposition_reason: null,
    created_at: now,
    updated_at: now,
  };
  const occurrence: FindingOccurrence = {
    id: occurrenceId,
    organization_id: organizationId,
    finding_id: findingId,
    repository_id: repositoryId,
    commit_id: commitId,
    analysis_run_id: '55555555-5555-4555-8555-555555555555',
    rule_id: finding.rule_id,
    semantic_target_id: 'db.query',
    normalized_fingerprint: 'occurrence-fingerprint',
    relationship_fingerprint: null,
    file_path: 'src/vulnerable.ts',
    start_line: 12,
    end_line: 12,
    observation: 'DETECTED',
    severity: 'HIGH',
    confidence: 'HIGH',
    evidence_strength: 'HIGH',
    exploitability: 'HIGH',
    reachability: 'HIGH',
    technical_risk: 80,
    resolution: 'EXACT',
    match_result: 'NEW',
    created_at: now,
  };
  const commit: RepositoryCommit = {
    id: commitId,
    organization_id: organizationId,
    repository_id: repositoryId,
    commit_sha: sha,
    parent_commit_sha: null,
    committed_at: now,
    indexed_at: now,
    created_at: now,
  };
  const app = createApiServer({
    async authenticate() { return { organizationId, userId }; },
    product: {
      members: {
        async getMembership() {
          return {
            id: 'member',
            organization_id: organizationId,
            user_id: userId,
            role: 'VIEWER',
            created_at: now,
            updated_at: now,
          };
        },
      },
      repositories: {
        async getById() { return repository; },
        async listByOrganization() { return [repository]; },
      },
      commits: {
        async getLatest() { return null; },
        async getById() { throw new Error('Findings list should use batch commit lookup'); },
        async getByIds(requestedOrganizationId, requestedRepositoryId, commitIds) {
          assert.equal(requestedOrganizationId, organizationId);
          assert.equal(requestedRepositoryId, repositoryId);
          assert.deepEqual(commitIds, [commitId]);
          return [commit];
        },
      },
      analysis: {
        async listRunsByRepository() { return []; },
        async getLatestJobForRun() { return null; },
      },
      findings: {
        async getByRepository() { return [finding]; },
        async getById() { return finding; },
        async getOccurrencesForFinding() {
          throw new Error('Findings list should use batch occurrence lookup');
        },
        async getOccurrencesForFindings(requestedOrganizationId, findingIds) {
          assert.equal(requestedOrganizationId, organizationId);
          assert.deepEqual(findingIds, [findingId]);
          return [occurrence];
        },
      },
      evidence: {
        async getEvidenceForFinding() { return []; },
        async getSnapshot() { return null; },
      },
      risks: { async getForFinding() { return []; } },
      health: {
        async getForRun() { return null; },
        async listByRepository() { return []; },
      },
      reports: { async listByRepository() { return []; } },
      aiInvestigations: { async getForOccurrence() { return []; } },
    },
  });

  try {
    const response = await app.inject({
      method: 'GET',
      url: `/repositories/${repositoryId}/findings`,
    });
    assert.equal(response.statusCode, 200, response.body);
    const body = response.json();
    assert.equal(body.findings[0].finding.lastSeenRevision, sha);
    assert.equal(body.findings[0].occurrence.commitSha, sha);
    assert.equal(body.findings[0].occurrence.filePath, occurrence.file_path);
    assert.equal(body.findings[0].occurrence.startLine, occurrence.start_line);
  } finally {
    await app.close();
  }
});

test('unhandled API failures return a safe structured response', async () => {
  const logLines: string[] = [];
  const app = createApiServer({
    async authenticate() {
      return null;
    },
    logger: {
      level: 'error',
      stream: { write: (line) => logLines.push(line) },
    },
  });
  app.get('/test/internal-error', async () => {
    throw new Error('database password and query text');
  });

  try {
    const response = await app.inject({ method: 'GET', url: '/test/internal-error' });
    assert.equal(response.statusCode, 500);
    assert.deepEqual(response.json(), {
      error: 'Internal server error',
      code: 'INTERNAL_ERROR',
    });
    assert.equal(response.body.includes('database password'), false);
    const errorLog = logLines
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .find((entry) => entry.msg === 'Unhandled API request error');
    assert.ok(errorLog);
    assert.equal(JSON.stringify(errorLog).includes('database password'), false);
    assert.equal('errorMessage' in errorLog, false);
    assert.equal('errorStack' in errorLog, false);
  } finally {
    await app.close();
  }
});
