import assert from 'node:assert/strict';
import test from 'node:test';

import type {
  EvidenceGraphRecord,
  EvidenceRecord,
  Finding,
  FindingOccurrence,
} from '@bugzero/database';

import { InMemorySourceAccess } from '../src/analyzers/source-access.js';
import { buildAIInvestigationContext } from '../src/ai/groq/groq-investigator.js';

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
