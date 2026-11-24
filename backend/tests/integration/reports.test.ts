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
} from '@bugzero/database';
import type { EvidenceRecord } from '@bugzero/database';
import { createApiServer } from '../../src/server.js';

const organizationId = '11111111-1111-4111-8111-111111111111';
const repositoryId = '22222222-2222-4222-8222-222222222222';
const userId = '33333333-3333-4333-8333-333333333333';
const runId = '44444444-4444-4444-8444-444444444444';
const reportId = '55555555-5555-4555-8555-555555555555';
const findingId = '66666666-6666-4666-8666-666666666666';
const occurrenceId = '77777777-7777-4777-8777-777777777777';
const evidenceId = '88888888-8888-4888-8888-888888888888';
const commitId = '99999999-9999-4999-8999-999999999999';
const timestamp = '2025-01-02T03:04:05.000Z';

const repository: RepositoryRecord = {
  id: repositoryId,
  organization_id: organizationId,
  provider: 'LOCAL',
  external_id: 'local-1',
  full_name: 'acme/example',
  default_branch: 'main',
  clone_url: '',
  created_at: timestamp,
  updated_at: timestamp,
};

const run: AnalysisRun = {
  id: runId,
  organization_id: organizationId,
  repository_id: repositoryId,
  commit_id: commitId,
  profile_id: 'default',
  profile_version: '1',
  scope: 'COMMIT',
  status: 'PARTIAL',
  coverage: { parsing: 'PARTIAL', filesInspected: 4 },
  created_at: timestamp,
  started_at: timestamp,
  completed_at: timestamp,
};

const commit: RepositoryCommit = {
  id: commitId,
  organization_id: organizationId,
  repository_id: repositoryId,
  commit_sha: 'a'.repeat(40),
  parent_commit_sha: null,
  committed_at: timestamp,
  indexed_at: timestamp,
  created_at: timestamp,
};

const finding: Finding = {
  id: findingId,
  organization_id: organizationId,
  repository_id: repositoryId,
  rule_id: 'SECURITY.SQL_INJECTION',
  identity_fingerprint: 'persisted-fingerprint',
  identity_version: '1',
  lifecycle: 'OPEN',
  current_occurrence_id: occurrenceId,
  resolution_evidence_id: null,
  current_severity: 'HIGH',
  current_confidence: 'HIGH',
  current_risk: '82.00',
  last_seen_commit_id: commitId,
  business_priority: null,
  accepted_risk: false,
  exception_id: null,
  disposition_reason: null,
  created_at: timestamp,
  updated_at: timestamp,
};

const occurrence: FindingOccurrence = {
  id: occurrenceId,
  organization_id: organizationId,
  finding_id: findingId,
  repository_id: repositoryId,
  commit_id: commitId,
  analysis_run_id: runId,
  rule_id: finding.rule_id,
  semantic_target_id: 'db.query',
  normalized_fingerprint: 'occurrence-fingerprint',
  relationship_fingerprint: null,
  file_path: 'src/unsafe.ts',
  start_line: 12,
  end_line: 14,
  observation: 'DETECTED',
  severity: 'HIGH',
  confidence: 'HIGH',
  evidence_strength: 'HIGH',
  exploitability: 'HIGH',
  reachability: 'HIGH',
  technical_risk: 82,
  resolution: 'EXACT',
  match_result: 'NEW',
  created_at: timestamp,
};

const evidence: EvidenceRecord = {
  id: evidenceId,
  organization_id: organizationId,
  finding_id: findingId,
  finding_occurrence_id: occurrenceId,
  analysis_run_id: runId,
  repository_id: repositoryId,
  commit_id: commitId,
  identity_fingerprint: 'evidence-fingerprint',
  authority: 'AUTHORITATIVE',
  origin: 'DETERMINISTIC_ANALYZER',
  sufficiency: 'SUFFICIENT',
  completeness: 'COMPLETE',
  complete: true,
  diagnostics: ['Untrusted input reaches a dynamic SQL sink.'],
  analyzer_versions: {},
  paths: [],
  created_at: timestamp,
};

const health: HealthSnapshot = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  organization_id: organizationId,
  repository_id: repositoryId,
  commit_id: commitId,
  analysis_run_id: runId,
  profile_id: 'default',
  profile_version: 1,
  model_version: '1',
  overall_score: null,
  overall_status: 'PARTIAL',
  coverage: 'PARTIAL',
  dimensions: {},
  profile_snapshot: {},
  calculation: {},
  explanation: 'Some dimensions are unavailable.',
  security_score: null,
  quality_score: 72,
  reliability_score: null,
  maintainability_score: 68,
  dependency_score: null,
  created_at: timestamp,
};

function createReportTestServer(options: {
  includeFinding?: boolean;
  runStatus?: AnalysisRun['status'];
  analysisRepositoryId?: string;
  member?: boolean;
} = {}) {
  const selectedRun = {
    ...run,
    status: options.runStatus ?? run.status,
    repository_id: options.analysisRepositoryId ?? run.repository_id,
  };
  let storedReport: ReportRecord | null = null;
  let savedDocument: Record<string, unknown> | null = null;
  let createCount = 0;
  let findingReadCount = 0;
  const app = createApiServer({
    async authenticate() {
      return { organizationId, userId };
    },
    product: {
      members: {
        async getMembership() {
          if (options.member === false) return null;
          return {
            id: 'member',
            organization_id: organizationId,
            user_id: userId,
            role: 'VIEWER',
            created_at: timestamp,
            updated_at: timestamp,
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
      analysis: {
        async getRun(requestedOrganizationId, requestedRunId) {
          return requestedOrganizationId === organizationId && requestedRunId === runId ? selectedRun : null;
        },
        async listRunsByRepository() {
          return [selectedRun];
        },
        async getLatestJobForRun() {
          return null;
        },
      },
      commits: {
        async getById() {
          return commit;
        },
        async getLatest() {
          return commit;
        },
      },
      findings: {
        async getByRepository() {
          findingReadCount += 1;
          return options.includeFinding === false ? [] : [finding];
        },
        async getById() {
          return finding;
        },
        async getOccurrencesForFinding() {
          return [occurrence];
        },
      },
      evidence: {
        async getEvidenceForFinding() {
          return options.includeFinding === false ? [] : [evidence];
        },
        async getSnapshot() {
          return { snapshot: evidence, nodes: [], edges: [] };
        },
      },
      risks: {
        async getForFinding() {
          return [];
        },
      },
      health: {
        async getForRun() {
          return health;
        },
        async listByRepository() {
          return [health];
        },
      },
      aiInvestigations: {
        async getForOccurrence() {
          return [];
        },
      },
      reports: {
        async listByRepository() {
          return storedReport ? [storedReport] : [];
        },
        async createOrGetReport(input) {
          createCount += 1;
          if (storedReport) return { record: storedReport, created: false };
          storedReport = {
            id: reportId,
            organization_id: input.organizationId,
            repository_id: input.repositoryId,
            analysis_run_id: input.analysisRunId,
            created_by_user_id: input.createdByUserId ?? null,
            format: input.format,
            object_key: null,
            metadata: input.metadata ?? {},
            created_at: timestamp,
          };
          return { record: storedReport, created: true };
        },
        async saveDocument(_organizationId, _reportId, document) {
          savedDocument = document;
          if (!storedReport) throw new Error('Expected report persistence before saving its document');
          storedReport = { ...storedReport, metadata: { ...storedReport.metadata, report: document } };
          return storedReport;
        },
        async getById(requestedOrganizationId, requestedReportId) {
          return requestedOrganizationId === organizationId && requestedReportId === reportId ? storedReport : null;
        },
      },
    },
  });
  return {
    app,
    getCreateCount: () => createCount,
    getFindingReadCount: () => findingReadCount,
    getSavedDocument: () => savedDocument,
  };
}

test('POST repository reports builds and persists an idempotent report from stored partial-analysis evidence', async () => {
  const testServer = createReportTestServer();
  try {
    const url = `/repositories/${repositoryId}/reports`;
    const first = await testServer.app.inject({
      method: 'POST',
      url,
      payload: { analysisRunId: runId },
    });
    assert.equal(first.statusCode, 201);
    const report = first.json().report;
    assert.equal(report.repository.name, 'acme/example');
    assert.equal(report.analysis.status, 'PARTIAL');
    assert.equal(report.analysis.commitSha, commit.commit_sha);
    assert.deepEqual(report.analysis.coverage, run.coverage);
    assert.equal(report.findings.security.length, 1);
    assert.equal(report.findings.security[0].findingId, findingId);
    assert.equal(report.findings.security[0].filePath, 'src/unsafe.ts');
    assert.equal(report.findings.security[0].evidenceAuthority, 'AUTHORITATIVE');
    assert.match(report.findings.security[0].evidence[1], /Untrusted input reaches/);
    assert.equal(report.findings.security[0].description, null);
    assert.equal(report.results.quality.score, 72);
    assert.equal(report.results.reliability.score, null);
    assert.equal(report.results.reliability.status, 'UNKNOWN');
    assert.equal(report.recommendations.length, 1);
    assert.equal(testServer.getSavedDocument() !== null, true);

    const second = await testServer.app.inject({
      method: 'POST',
      url,
      payload: { analysisRunId: runId },
    });
    assert.equal(second.statusCode, 200);
    assert.deepEqual(second.json(), first.json());
    assert.equal(testServer.getCreateCount(), 2);
    assert.equal(testServer.getFindingReadCount(), 1);

    const loaded = await testServer.app.inject({ method: 'GET', url: `/reports/${reportId}` });
    assert.equal(loaded.statusCode, 200);
    assert.deepEqual(loaded.json(), first.json());
    const history = await testServer.app.inject({
      method: 'GET',
      url: `/repositories/${repositoryId}/reports`,
    });
    assert.equal(history.statusCode, 200);
    assert.deepEqual(history.json().reports[0].metadata, {
      title: 'Analysis report — acme/example',
    });
    assert.equal(history.body.includes('Untrusted input reaches'), false);
  } finally {
    await testServer.app.close();
  }
});

test('report generation enforces organization membership and analysis repository scope', async () => {
  const noMembership = createReportTestServer({ member: false });
  const wrongRepositoryRun = createReportTestServer({
    analysisRepositoryId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  });
  try {
    const url = `/repositories/${repositoryId}/reports`;
    const forbidden = await noMembership.app.inject({
      method: 'POST',
      url,
      payload: { analysisRunId: runId },
    });
    assert.equal(forbidden.statusCode, 403);
    const wrongScope = await wrongRepositoryRun.app.inject({
      method: 'POST',
      url,
      payload: { analysisRunId: runId },
    });
    assert.equal(wrongScope.statusCode, 404);
  } finally {
    await Promise.all([noMembership.app.close(), wrongRepositoryRun.app.close()]);
  }
});

test('report creation labels empty findings and unknown analysis dimensions without inventing data', async () => {
  const testServer = createReportTestServer({ includeFinding: false });
  try {
    const response = await testServer.app.inject({
      method: 'POST',
      url: `/repositories/${repositoryId}/reports`,
      payload: { analysisRunId: runId },
    });
    assert.equal(response.statusCode, 201);
    const report = response.json().report;
    assert.equal(report.findings.total, 0);
    assert.deepEqual(report.findings.security, []);
    assert.deepEqual(report.findings.codeQuality, []);
    assert.equal(report.results.reliability.score, null);
    assert.equal(report.results.dependencies.score, null);
    assert.equal(report.recommendations.length, 0);
  } finally {
    await testServer.app.close();
  }
});

test('report creation rejects missing, malformed, and non-completed analyses', async () => {
  const testServer = createReportTestServer({ runStatus: 'RUNNING' });
  try {
    const noRun = await testServer.app.inject({
      method: 'POST',
      url: `/repositories/${repositoryId}/reports`,
      payload: {},
    });
    assert.equal(noRun.statusCode, 400);
    const malformed = await testServer.app.inject({
      method: 'POST',
      url: `/repositories/${repositoryId}/reports`,
      payload: { analysisRunId: 'not-a-uuid' },
    });
    assert.equal(malformed.statusCode, 400);
    const running = await testServer.app.inject({
      method: 'POST',
      url: `/repositories/${repositoryId}/reports`,
      payload: { analysisRunId: runId },
    });
    assert.equal(running.statusCode, 409);
  } finally {
    await testServer.app.close();
  }
});
