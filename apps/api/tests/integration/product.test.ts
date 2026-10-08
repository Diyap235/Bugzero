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
    queue: { async enqueue() {} },
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

test('GET repository history reuses persisted metrics for repeated runs of the same commit', async () => {
  const firstRunId = '55555555-5555-4555-8555-555555555555';
  const repeatedRunId = '66666666-6666-4666-8666-666666666666';
  const commitId = '77777777-7777-4777-8777-777777777777';
  const findingId = '88888888-8888-4888-8888-888888888888';
  const occurrenceId = '99999999-9999-4999-8999-999999999999';
  const now = new Date(0).toISOString();
  const runs: AnalysisRun[] = [firstRunId, repeatedRunId].map((id) => ({
    id,
    organization_id: organizationId,
    repository_id: repositoryId,
    commit_id: commitId,
    profile_id: 'default-v1',
    profile_version: '1',
    scope: 'COMMIT',
    status: 'COMPLETED',
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
    dimensions: {},
    profile_snapshot: {},
    calculation: {},
    explanation: 'Persisted health snapshot',
    security_score: 84,
    quality_score: 100,
    reliability_score: null,
    maintainability_score: 100,
    dependency_score: null,
    created_at: now,
  };
  const app = createApiServer({
    async authenticate() {
      return { organizationId, userId };
    },
    queue: { async enqueue() {} },
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
          return [occurrence];
        },
      },
      risks: {
        async getForFinding() {
          return [risk];
        },
      },
      health: {
        async getLatest() {
          return healthSnapshot;
        },
        async listByRepository() {
          return [healthSnapshot];
        },
      },
    },
  });

  try {
    const response = await app.inject({ method: 'GET', url: `/repositories/${repositoryId}/history` });
    assert.equal(response.statusCode, 200);
    const history = response.json().history as Array<{
      findingCount: number;
      totalTechnicalRisk: number;
      healthScore: number | null;
    }>;
    assert.deepEqual(history.map(({ findingCount, totalTechnicalRisk, healthScore }) =>
      ({ findingCount, totalTechnicalRisk, healthScore })), [
      { findingCount: 1, totalTechnicalRisk: 80, healthScore: 91 },
      { findingCount: 1, totalTechnicalRisk: 80, healthScore: 91 },
    ]);
  } finally {
    await app.close();
  }
});

test('unhandled API failures return a safe structured response', async () => {
  const app = createApiServer({
    async authenticate() {
      return null;
    },
    queue: { async enqueue() {} },
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
  } finally {
    await app.close();
  }
});
