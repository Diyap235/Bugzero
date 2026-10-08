import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  AIInvestigationRecord,
  AnalysisRun,
  EvidenceGraphRecord,
  Finding,
  FindingOccurrence,
  RiskAssessmentRecord,
} from '@bugzero/database';
import { createApiServer } from '../../src/server.js';

const organizationId = '11111111-1111-4111-8111-111111111111';
const repositoryId = '22222222-2222-4222-8222-222222222222';
const commitId = '33333333-3333-4333-8333-333333333333';
const runId = '44444444-4444-4444-8444-444444444444';
const findingId = '55555555-5555-4555-8555-555555555555';
const occurrenceId = '66666666-6666-4666-8666-666666666666';
const evidenceId = '77777777-7777-4777-8777-777777777777';
const userId = '88888888-8888-4888-8888-888888888888';
const timestamp = new Date(0).toISOString();

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
  current_risk: 84,
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
  file_path: 'src/vulnerable.py',
  start_line: 5,
  end_line: 5,
  observation: 'DETECTED',
  severity: 'HIGH',
  confidence: 'HIGH',
  evidence_strength: 'HIGH',
  exploitability: 'HIGH',
  reachability: 'HIGH',
  technical_risk: 84,
  resolution: 'EXACT',
  match_result: 'SAME',
  created_at: timestamp,
};

const evidence: EvidenceGraphRecord = {
  snapshot: {
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
    diagnostics: [],
    analyzer_versions: { sql: '1' },
    paths: [{
      id: 'request-to-query',
      nodeIds: ['source', 'query'],
      edgeIds: ['flows-to'],
      completeness: 'COMPLETE',
      diagnostics: [],
    }],
    created_at: timestamp,
  },
  nodes: [
    {
      organization_id: organizationId,
      evidence_id: evidenceId,
      node_key: 'source',
      node_type: 'SOURCE',
      label: 'request.userId',
      file_path: 'src/vulnerable.py',
      line: 3,
      end_line: 3,
      start_column: null,
      end_column: null,
      attributes: { provenance: 'SECURITY_ANALYZER' },
    },
    {
      organization_id: organizationId,
      evidence_id: evidenceId,
      node_key: 'query',
      node_type: 'SINK',
      label: 'db.query(sql)',
      file_path: 'src/vulnerable.py',
      line: 5,
      end_line: 5,
      start_column: null,
      end_column: null,
      attributes: { provenance: 'SECURITY_ANALYZER' },
    },
  ],
  edges: [{
    organization_id: organizationId,
    evidence_id: evidenceId,
    edge_key: 'flows-to',
    from_node_key: 'source',
    to_node_key: 'query',
    relation: 'REACHES_SQL_SINK',
    resolution: 'EXACT',
    confidence: 'HIGH',
    attributes: { provenance: 'SECURITY_ANALYZER' },
  }],
};

const risk: RiskAssessmentRecord = {
  id: '99999999-9999-4999-8999-999999999999',
  organization_id: organizationId,
  finding_id: findingId,
  finding_occurrence_id: occurrenceId,
  evidence_id: evidenceId,
  repository_id: repositoryId,
  commit_id: commitId,
  analysis_run_id: runId,
  profile_id: 'default-v1',
  profile_version: 1,
  model_version: 'bugzero-deterministic-risk-v1',
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
  technical_risk: 84,
  risk_band: 'CRITICAL',
  profile_snapshot: { id: 'default-v1' },
  factors: { confidence: { value: 'HIGH' } },
  calculation: { finalScore: 84 },
  explanation: 'Persisted deterministic risk calculation.',
  assessed_at: timestamp,
};

const aiRecord: AIInvestigationRecord = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  provider: 'GROQ',
  model: 'test-model',
  prompt_version: 'v1',
  status: 'COMPLETED',
  result: {
    summary: 'The query uses request-controlled input.',
    explanation: 'The value reaches SQL construction before the database call.',
    attackPath: ['request.userId', 'SQL construction', 'db.query'],
    remediation: ['Use a parameterized query.'],
    confidence: 'HIGH',
    reasoningStatus: 'SUPPORTED',
  },
  error_code: null,
  organization_id: organizationId,
  finding_id: findingId,
  finding_occurrence_id: occurrenceId,
  evidence_id: evidenceId,
  idempotency_key: 'test',
  content: null,
  created_at: timestamp,
  updated_at: timestamp,
};

const commit = {
  id: commitId,
  organization_id: organizationId,
  repository_id: repositoryId,
  commit_sha: 'a'.repeat(40),
  parent_commit_sha: null,
  committed_at: timestamp,
  indexed_at: timestamp,
  created_at: timestamp,
};

type MLReportStatus = 'AVAILABLE' | 'UNAVAILABLE' | 'NOT_APPLICABLE';

function makeSignalReport(status: MLReportStatus, filePath = 'src/vulnerable.py') {
  return {
    status,
    functionsConsidered: 1,
    functionsScored: status === 'AVAILABLE' ? 1 : 0,
    duplicateFunctionsAvoided: 0,
    oversizedFunctionsSkipped: 0,
    signals: status === 'AVAILABLE' ? [{
      function: {
        functionId: 'function-1',
        functionName: 'get_user',
        filePath,
        startLine: 1,
        endLine: 5,
      },
      modelVersion: 'v1',
      label: 'vulnerable',
      score: 0.5349,
      timestamp,
    }] : [],
  };
}

function makeRun(report: ReturnType<typeof makeSignalReport>): AnalysisRun {
  return {
    id: runId,
    organization_id: organizationId,
    repository_id: repositoryId,
    commit_id: commitId,
    profile_id: 'default-v1',
    profile_version: '1',
    scope: 'COMMIT',
    status: 'COMPLETED',
    coverage: {
      pipeline: {
        status: 'COMPLETED',
        mlSignals: report,
        aiInvestigation: { status: 'UNAVAILABLE', attempted: 0, completed: 0, failed: 0, reused: 0 },
      },
    },
    created_at: timestamp,
    started_at: timestamp,
    completed_at: timestamp,
  };
}

function makeApp(options: {
  mlStatus?: MLReportStatus;
  mlFilePath?: string;
  aiRecord?: AIInvestigationRecord | null;
  evidenceRecord?: EvidenceGraphRecord | null;
  riskRecord?: RiskAssessmentRecord;
} = {}) {
  const report = makeSignalReport(options.mlStatus ?? 'NOT_APPLICABLE', options.mlFilePath);
  const selectedEvidence = options.evidenceRecord ?? evidence;
  return createApiServer({
    async authenticate() { return { organizationId, userId }; },
    queue: { async enqueue() {} },
    product: {
      members: {
        async getMembership() {
          return { id: 'member', organization_id: organizationId, user_id: userId, role: 'VIEWER', created_at: timestamp, updated_at: timestamp };
        },
      },
      commits: {
        async getById() { return commit; },
        async getLatest() { return commit; },
      },
      analysis: {
        async listRunsByRepository() { return [makeRun(report)]; },
        async getLatestJobForRun() { return null; },
      },
      findings: {
        async getById() { return finding; },
        async getByRepository() { return [finding]; },
        async getOccurrencesForFinding() { return [occurrence]; },
      },
      evidence: {
        async getEvidenceForFinding() { return options.evidenceRecord === null ? [] : [selectedEvidence.snapshot]; },
        async getSnapshot() { return options.evidenceRecord === null ? null : selectedEvidence; },
      },
      risks: { async getForFinding() { return [options.riskRecord ?? risk]; } },
      aiInvestigations: {
        async getForOccurrence() { return options.aiRecord === null ? [] : [options.aiRecord ?? aiRecord]; },
      },
    },
  });
}

async function getFinding(app: ReturnType<typeof makeApp>) {
  return app.inject({ method: 'GET', url: `/findings/${findingId}` });
}

test('finding intelligence degrades gracefully and keeps persisted authorities separate', async (t) => {
  const evidenceBefore = structuredClone(evidence);
  const riskBefore = structuredClone(risk);
  const incompleteEvidence: EvidenceGraphRecord = {
    ...evidence,
    snapshot: {
      ...evidence.snapshot,
      authority: 'INVESTIGATIVE',
      sufficiency: 'INSUFFICIENT',
      completeness: 'PARTIAL',
      complete: false,
    },
  };
  const incompleteRisk: RiskAssessmentRecord = {
    ...risk,
    evidence_authority: 'INVESTIGATIVE',
    evidence_sufficiency: 'INSUFFICIENT',
    evidence_completeness: 'PARTIAL',
  };
  const cases: Array<{
    name: string;
    options: {
      mlStatus?: MLReportStatus;
      mlFilePath?: string;
      aiRecord?: AIInvestigationRecord | null;
      evidenceRecord?: EvidenceGraphRecord | null;
      riskRecord?: RiskAssessmentRecord;
    };
    expectML: boolean;
    expectAI: boolean;
  }> = [
    {
      name: 'deterministic evidence and persisted risk only',
      options: { mlStatus: 'NOT_APPLICABLE' as const, aiRecord: null },
      expectML: false,
      expectAI: false,
    },
    {
      name: 'matching ML signal stays investigative',
      options: { mlStatus: 'AVAILABLE' as const, aiRecord: null },
      expectML: true,
      expectAI: false,
    },
    {
      name: 'Groq explanation and recommended fix stay explanatory',
      options: { mlStatus: 'NOT_APPLICABLE' as const },
      expectML: false,
      expectAI: true,
    },
    {
      name: 'ML and Groq aggregate without changing evidence or risk',
      options: { mlStatus: 'AVAILABLE' as const },
      expectML: true,
      expectAI: true,
    },
    {
      name: 'unavailable ML leaves the finding readable',
      options: { mlStatus: 'UNAVAILABLE' as const, aiRecord: null },
      expectML: false,
      expectAI: false,
    },
    {
      name: 'failed Groq investigation leaves deterministic data readable',
      options: { mlStatus: 'NOT_APPLICABLE' as const, aiRecord: { ...aiRecord, status: 'FAILED' as const, result: null, error_code: 'PROVIDER_ERROR' as const } },
      expectML: false,
      expectAI: false,
    },
    {
      name: 'signal from a different file is not attributed to this finding',
      options: { mlStatus: 'AVAILABLE' as const, mlFilePath: 'src/other.py', aiRecord: null },
      expectML: false,
      expectAI: false,
    },
    {
      name: 'missing optional evidence snapshot does not break finding retrieval',
      options: { mlStatus: 'NOT_APPLICABLE' as const, evidenceRecord: null, aiRecord: null },
      expectML: false,
      expectAI: false,
    },
    {
      name: 'ML and Groq do not upgrade incomplete investigative evidence',
      options: {
        mlStatus: 'AVAILABLE',
        evidenceRecord: incompleteEvidence,
        riskRecord: incompleteRisk,
      },
      expectML: true,
      expectAI: true,
    },
  ];

  for (const item of cases) {
    await t.test(item.name, async () => {
      const app = makeApp(item.options);
      try {
        const response = await getFinding(app);
        assert.equal(response.statusCode, 200, response.body);
        const body = response.json();
        assert.equal(body.title, 'SQL Injection');
        assert.equal(body.finding.currentSeverity, 'HIGH');
        assert.equal(body.finding.currentConfidence, 'HIGH');
        assert.equal(body.finding.lifecycle, 'OPEN');
        assert.deepEqual(body.location, { filePath: occurrence.file_path, startLine: 5, endLine: 5 });
        const expectedRisk = item.options.riskRecord ?? risk;
        const expectedEvidence = item.options.evidenceRecord ?? evidence;
        assert.deepEqual(body.risk, expectedRisk);
        assert.equal(body.risk.model_version, 'bugzero-deterministic-risk-v1');
        assert.equal(body.risk.technical_risk, 84);
        assert.equal(body.risk.dependency_exposure, 'UNKNOWN');
        assert.equal(body.evidence?.snapshot.authority ?? null, item.options.evidenceRecord === null ? null : expectedEvidence.snapshot.authority);
        assert.equal(body.evidence?.snapshot.completeness ?? null, item.options.evidenceRecord === null ? null : expectedEvidence.snapshot.completeness);
        assert.equal(body.evidence?.snapshot.sufficiency ?? null, item.options.evidenceRecord === null ? null : expectedEvidence.snapshot.sufficiency);
        assert.equal(body.evidence?.nodes[0]?.label ?? null, item.options.evidenceRecord === null ? null : 'request.userId');
        assert.equal(body.mlSignal !== null, item.expectML);
        assert.equal(body.aiExplanation?.status === 'COMPLETED', item.expectAI);
        assert.equal(body.aiInvestigationStatus, item.options.aiRecord === null
          ? 'UNAVAILABLE'
          : (item.options.aiRecord ?? aiRecord).status);
        if (body.aiExplanation) assert.equal(body.aiExplanation.classification, 'EXPLANATORY');
        assert.deepEqual(body.recommendedFix, item.expectAI ? aiRecord.result?.remediation : null);

        if (item.expectML) {
          assert.equal(body.mlSignal.classification, 'INVESTIGATIVE');
          assert.equal(body.mlSignal.modelVersion, 'v1');
          assert.equal(body.mlSignal.score, 0.5349);
          assert.deepEqual(Object.keys(body.mlSignal).sort(), [
            'classification', 'function', 'label', 'modelVersion', 'score', 'timestamp',
          ]);
          for (const prohibited of [
            'authority', 'evidenceAuthority', 'evidenceCompleteness',
            'evidenceSufficiency', 'confirmed', 'findingConfidenceOverride',
          ]) assert.equal(prohibited in body.mlSignal, false);
        }

        if (item.options.mlStatus === 'UNAVAILABLE') {
          assert.equal(body.mlSignalStatus, 'UNAVAILABLE');
          assert.equal(body.mlSignal, null);
        }
        if (item.options.aiRecord?.status === 'FAILED') {
          assert.equal(body.aiExplanation.status, 'FAILED');
          assert.equal(body.aiExplanation.explanation, null);
          assert.equal(body.recommendedFix, null);
        }
        assert.deepEqual(evidence, evidenceBefore);
        assert.deepEqual(risk, riskBefore);
      } finally {
        await app.close();
      }
    });
  }
});
