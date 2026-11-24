import assert from 'node:assert/strict';
import test from 'node:test';

import type {
  AIInvestigationRecord,
  EvidenceGraphRecord,
  EvidenceRecord,
  Finding,
  FindingOccurrence,
} from '@bugzero/database';

import { InMemorySourceAccess } from '../src/analyzers/source-access.js';
import { buildAIInvestigationContext, investigatePersistedFindings } from '../src/ai/investigator.js';
import type { AIInvestigator } from '../src/ai/investigation-types.js';

const finding: Finding = {
  id: 'finding-1',
  organization_id: 'organization-1',
  repository_id: 'repository-1',
  rule_id: 'TEST_RULE',
  identity_fingerprint: 'finding-fingerprint',
  identity_version: '1',
  lifecycle: 'OPEN',
  current_occurrence_id: 'occurrence-1',
  resolution_evidence_id: null,
  current_severity: 'MEDIUM',
  current_confidence: 'HIGH',
  current_risk: 5,
  last_seen_commit_id: 'commit-1',
  business_priority: null,
  accepted_risk: false,
  exception_id: null,
  disposition_reason: null,
  created_at: new Date(0).toISOString(),
  updated_at: new Date(0).toISOString(),
};

const occurrence: FindingOccurrence = {
  id: 'occurrence-1',
  organization_id: 'organization-1',
  finding_id: finding.id,
  repository_id: finding.repository_id,
  commit_id: 'commit-1',
  analysis_run_id: 'run-1',
  rule_id: finding.rule_id,
  semantic_target_id: 'target-1',
  normalized_fingerprint: 'occurrence-fingerprint',
  relationship_fingerprint: null,
  file_path: 'src/example.ts',
  start_line: 3,
  end_line: 3,
  observation: 'DETECTED',
  severity: 'MEDIUM',
  confidence: 'HIGH',
  evidence_strength: 'HIGH',
  exploitability: 'MEDIUM',
  reachability: 'HIGH',
  technical_risk: 5,
  resolution: 'EXACT',
  match_result: 'NEW',
  created_at: new Date(0).toISOString(),
};

const evidence: EvidenceRecord = {
  id: 'evidence-1',
  organization_id: finding.organization_id,
  finding_id: finding.id,
  finding_occurrence_id: occurrence.id,
  analysis_run_id: occurrence.analysis_run_id,
  repository_id: finding.repository_id,
  commit_id: occurrence.commit_id,
  identity_fingerprint: 'evidence-fingerprint',
  authority: 'AUTHORITATIVE',
  origin: 'DETERMINISTIC_ANALYZER',
  sufficiency: 'SUFFICIENT',
  completeness: 'COMPLETE',
  complete: true,
  diagnostics: [],
  analyzer_versions: {},
  paths: [],
  created_at: new Date(0).toISOString(),
};

function graphWithPaths(paths: string[]): EvidenceGraphRecord {
  return {
    snapshot: evidence,
    nodes: paths.map((filePath, index) => ({
      organization_id: finding.organization_id,
      evidence_id: evidence.id,
      node_key: `node-${index}`,
      node_type: 'SOURCE' as const,
      label: `source-${index}`,
      file_path: filePath,
      line: 3,
      end_line: 3,
      start_column: null,
      end_column: null,
      attributes: {},
    })),
    edges: [],
  };
}

test('investigation context redacts source secrets and excludes sensitive paths', async () => {
  const source = new InMemorySourceAccess(new Map([
    ['src/example.ts', [
      'const api_key = "test_api_key_value";',
      'const authorization = "Bearer test_bearer_value";',
      'export function inspect() {}',
    ].join('\n')],
    ['src/.env', 'API_KEY="must_not_be_read"'],
  ]));
  const result = await buildAIInvestigationContext({
    analysisStatus: 'COMPLETED',
    finding,
    occurrence,
    evidence,
    graph: graphWithPaths(['src/.env']),
    sourceAccess: source,
  });
  assert.equal(result.sourceSnippets.length, 1);
  assert.doesNotMatch(result.sourceSnippets[0].source, /test_api_key_value|test_bearer_value|must_not_be_read/);
  assert.match(result.sourceSnippets[0].source, /\[REDACTED\]/);
});

test('investigation context applies graph, path, and source bounds', async () => {
  const filePaths = Array.from({ length: 40 }, (_, index) => `src/file${index}.ts`);
  const graph = graphWithPaths(filePaths);
  graph.nodes = graph.nodes.map((node, index) => ({
    ...node,
    node_key: `node-${index}`,
    label: `source-${index}`,
  }));
  graph.edges = Array.from({ length: 40 }, (_, index) => ({
    organization_id: finding.organization_id,
    evidence_id: evidence.id,
    edge_key: `edge-${index}`,
    from_node_key: `node-${index % 24}`,
    to_node_key: `node-${index % 24}`,
    relation: 'CALLS',
    resolution: 'EXACT' as const,
    confidence: 'HIGH' as const,
    attributes: {},
  }));
  const source = new InMemorySourceAccess(new Map(
    filePaths.map((filePath) => [filePath, 'line one\nline two\nline three'] as const),
  ));
  const result = await buildAIInvestigationContext({
    analysisStatus: 'PARTIAL',
    finding,
    occurrence,
    evidence: { ...evidence, paths: Array.from({ length: 10 }, (_, index) => ({
      id: `path-${index}`,
      nodeIds: ['node-1'],
      edgeIds: ['edge-1'],
      completeness: 'PARTIAL' as const,
      diagnostics: [],
    })) },
    graph,
    sourceAccess: source,
  });
  assert.equal(result.evidence.nodes.length, 24);
  assert.equal(result.evidence.edges.length, 32);
  assert.equal(result.evidence.paths.length, 6);
  assert.equal(result.sourceSnippets.length, 6);
});

test('investigates each distinct finding once and reuses persisted results on replay', async () => {
  const findings = [finding, {
    ...finding,
    id: 'finding-2',
    rule_id: 'TEST_RULE_2',
    current_occurrence_id: 'occurrence-2',
  }];
  const occurrences = findings.map((item, index) => ({
    ...occurrence,
    id: `occurrence-${index + 1}`,
    finding_id: item.id,
  }));
  const evidenceRecords = findings.map((item, index) => ({
    ...evidence,
    id: `evidence-${index + 1}`,
    finding_id: item.id,
    finding_occurrence_id: `occurrence-${index + 1}`,
  }));
  const records = new Map<string, AIInvestigationRecord>();
  const requestedRuleIds: string[] = [];
  const result = {
    summary: 'Summary',
    explanation: 'Explanation',
    attackPath: ['Inspect the source'],
    remediation: ['Review the finding'],
    confidence: 'MEDIUM' as const,
    reasoningStatus: 'SUPPORTED' as const,
  };
  const investigator: AIInvestigator = {
    enabled: true,
    availability: 'ENABLED',
    provider: 'NVIDIA',
    model: 'test-model',
    promptVersion: 'test-prompt',
    async investigate(context) {
      requestedRuleIds.push(context.finding.ruleId);
      return { status: 'COMPLETED', result, errorCode: null };
    },
  };
  const input = {
    organizationId: finding.organization_id,
    repositoryId: finding.repository_id,
    commitId: occurrence.commit_id,
    analysisRunId: occurrence.analysis_run_id,
    analysisStatus: 'COMPLETED' as const,
    findingIds: [findings[0].id, findings[1].id, findings[0].id],
    sourceAccess: new InMemorySourceAccess(new Map([['src/example.ts', 'export function inspect() {}']])),
    investigator,
    findings: {
      async getById(_organizationId: string, findingId: string) {
        return findings.find((item) => item.id === findingId) ?? null;
      },
      async getOccurrencesForFinding(_organizationId: string, findingId: string) {
        return occurrences.filter((item) => item.finding_id === findingId);
      },
    },
    evidence: {
      async getEvidenceForFinding(_organizationId: string, findingId: string) {
        return evidenceRecords.filter((item) => item.finding_id === findingId);
      },
      async getSnapshot(_organizationId: string, evidenceId: string) {
        const item = evidenceRecords.find((record) => record.id === evidenceId);
        return item ? graphWithPaths(['src/example.ts']) : null;
      },
    },
    investigations: {
      async getByIdempotencyKey(_organizationId: string, occurrenceId: string, idempotencyKey: string) {
        return records.get(`${occurrenceId}:${idempotencyKey}`) ?? null;
      },
      async createOrGet(value: {
        organizationId: string;
        findingId: string;
        findingOccurrenceId: string;
        evidenceId: string;
        provider: 'NVIDIA';
        model: string;
        promptVersion: string;
        idempotencyKey: string;
        result: typeof result | null;
        errorCode: null;
      }) {
        const key = `${value.findingOccurrenceId}:${value.idempotencyKey}`;
        const existing = records.get(key);
        if (existing) return { record: existing, created: false };
        const now = new Date(0).toISOString();
        const record: AIInvestigationRecord = {
          id: `investigation-${records.size + 1}`,
          organization_id: value.organizationId,
          finding_id: value.findingId,
          finding_occurrence_id: value.findingOccurrenceId,
          evidence_id: value.evidenceId,
          provider: value.provider,
          model: value.model,
          prompt_version: value.promptVersion,
          idempotency_key: value.idempotencyKey,
          status: value.result ? 'COMPLETED' : 'FAILED',
          content: value.result ? JSON.stringify(value.result) : null,
          result: value.result,
          error_code: value.errorCode,
          created_at: now,
          updated_at: now,
        };
        records.set(key, record);
        return { record, created: true };
      },
    },
  };

  const first = await investigatePersistedFindings(input);
  assert.deepEqual(first, { status: 'COMPLETED', attempted: 2, completed: 2, failed: 0, reused: 0 });
  assert.deepEqual(requestedRuleIds, ['TEST_RULE', 'TEST_RULE_2']);
  assert.equal(records.size, 2);

  const replay = await investigatePersistedFindings(input);
  assert.deepEqual(replay, { status: 'COMPLETED', attempted: 0, completed: 2, failed: 0, reused: 2 });
  assert.deepEqual(requestedRuleIds, ['TEST_RULE', 'TEST_RULE_2']);
  assert.equal(records.size, 2);
});

test('a later queue replay retries a failed investigation without replacing persisted records', async () => {
  const records = new Map<string, AIInvestigationRecord>();
  let calls = 0;
  const investigator: AIInvestigator = {
    enabled: true,
    availability: 'ENABLED',
    provider: 'NVIDIA',
    model: 'test-model',
    promptVersion: 'test-prompt',
    async investigate() {
      calls += 1;
      return calls === 1
        ? { status: 'FAILED', result: null, errorCode: 'PROVIDER_ERROR' }
        : {
          status: 'COMPLETED',
          result: {
            summary: 'Summary',
            explanation: 'Evidence-backed explanation.',
            attackPath: ['Check the source.'],
            remediation: ['Apply a safe fix.'],
            confidence: 'MEDIUM',
            reasoningStatus: 'SUPPORTED',
          },
          errorCode: null,
        };
    },
  };
  const input = {
    organizationId: finding.organization_id,
    repositoryId: finding.repository_id,
    commitId: occurrence.commit_id,
    analysisRunId: occurrence.analysis_run_id,
    analysisStatus: 'COMPLETED' as const,
    findingIds: [finding.id],
    sourceAccess: new InMemorySourceAccess(new Map([['src/example.ts', 'export function inspect() {}']])),
    investigator,
    findings: {
      async getById() { return finding; },
      async getOccurrencesForFinding() { return [occurrence]; },
    },
    evidence: {
      async getEvidenceForFinding() { return [evidence]; },
      async getSnapshot() { return graphWithPaths(['src/example.ts']); },
    },
    investigations: {
      async getByIdempotencyKey(_organizationId: string, occurrenceId: string, key: string) {
        return records.get(`${occurrenceId}:${key}`) ?? null;
      },
      async getForOccurrence(_organizationId: string, occurrenceId: string) {
        return [...records.values()].filter((record) => record.finding_occurrence_id === occurrenceId);
      },
      async createOrGet(value: {
        organizationId: string;
        findingId: string;
        findingOccurrenceId: string;
        evidenceId: string;
        provider: 'NVIDIA';
        model: string;
        promptVersion: string;
        idempotencyKey: string;
        result: AIInvestigationRecord['result'];
        errorCode: AIInvestigationRecord['error_code'];
      }) {
        const key = `${value.findingOccurrenceId}:${value.idempotencyKey}`;
        const existing = records.get(key);
        if (existing) return { record: existing, created: false };
        const timestamp = new Date(0).toISOString();
        const record: AIInvestigationRecord = {
          id: `retry-${records.size + 1}`,
          organization_id: value.organizationId,
          finding_id: value.findingId,
          finding_occurrence_id: value.findingOccurrenceId,
          evidence_id: value.evidenceId,
          provider: value.provider,
          model: value.model,
          prompt_version: value.promptVersion,
          idempotency_key: value.idempotencyKey,
          status: value.result ? 'COMPLETED' : 'FAILED',
          content: value.result ? JSON.stringify(value.result) : null,
          result: value.result,
          error_code: value.errorCode,
          created_at: timestamp,
          updated_at: timestamp,
        };
        records.set(key, record);
        return { record, created: true };
      },
    },
  };

  const first = await investigatePersistedFindings(input);
  assert.equal(first.status, 'FAILED');
  assert.equal(first.failed, 1);
  assert.equal(records.size, 1);
  const retry = await investigatePersistedFindings(input);
  assert.equal(retry.status, 'COMPLETED');
  assert.equal(retry.completed, 1);
  assert.equal(calls, 2);
  assert.equal(records.size, 2);
  assert.equal([...records.values()].filter((record) => record.status === 'FAILED').length, 1);
  assert.equal([...records.values()].filter((record) => record.status === 'COMPLETED').length, 1);

  const replay = await investigatePersistedFindings(input);
  assert.equal(replay.reused, 1);
  assert.equal(replay.completed, 1);
  assert.equal(calls, 2);
});
