import test from 'node:test';
import assert from 'node:assert/strict';

import { EvidencePathBuilder } from '../src/evidence/evidence-path-builder.js';
import { buildFindingEvidenceGraph } from '../src/evidence/finding-evidence.js';
import { MemoryEvidenceRepository } from './support/memory-evidence.js';
import type { CodeEntityRecord, CodeRelationshipRecord } from '@bugzero/database';
import type { FindingCandidate } from '../src/analyzers/types.js';
import type { RepositoryIntelligenceSnapshot } from '../src/intelligence/types.js';

const builder = new EvidencePathBuilder();

test('EvidencePathBuilder preserves ordered exact relationship paths and terminates on cycles', () => {
  const result = builder.buildPaths(
    'A',
    'C',
    [{ id: 'A' }, { id: 'B' }, { id: 'C' }],
    [
      { id: 'e1', from: 'A', to: 'B', relation: 'CALLS', resolution: 'EXACT' },
      { id: 'e2', from: 'B', to: 'A', relation: 'CALLS', resolution: 'EXACT' },
      { id: 'e3', from: 'B', to: 'C', relation: 'CALLS', resolution: 'EXACT' },
    ],
  );

  assert.equal(result.completeness, 'COMPLETE');
  assert.deepEqual(result.paths[0]?.nodeIds, ['A', 'B', 'C']);
  assert.deepEqual(result.paths[0]?.edgeIds, ['e1', 'e3']);
});

test('EvidencePathBuilder reports unresolved edges, depth limits, and max-path exhaustion as partial', () => {
  const unresolved = builder.buildPaths(
    'A',
    'C',
    [{ id: 'A' }, { id: 'B' }, { id: 'C' }],
    [
      { id: 'e1', from: 'A', to: 'B', relation: 'CALLS', resolution: 'EXACT' },
      { id: 'unknown', from: 'B', to: 'C', relation: 'CALLS', resolution: 'UNKNOWN' },
    ],
  );
  assert.equal(unresolved.completeness, 'PARTIAL');
  assert.equal(unresolved.paths.length, 0);
  assert.match(unresolved.diagnostics.join(' '), /Unresolved relationships/);

  const depthLimited = builder.buildPaths(
    'A',
    'C',
    [{ id: 'A' }, { id: 'B' }, { id: 'C' }],
    [
      { id: 'e1', from: 'A', to: 'B', relation: 'CALLS', resolution: 'EXACT' },
      { id: 'e2', from: 'B', to: 'C', relation: 'CALLS', resolution: 'EXACT' },
    ],
    { maxDepth: 1 },
  );
  assert.equal(depthLimited.completeness, 'PARTIAL');
  assert.match(depthLimited.diagnostics.join(' '), /maxDepth/);

  const pathLimited = builder.buildPaths(
    'A',
    'D',
    [{ id: 'A' }, { id: 'B' }, { id: 'C' }, { id: 'D' }],
    [
      { id: 'e1', from: 'A', to: 'B', relation: 'CALLS', resolution: 'EXACT' },
      { id: 'e2', from: 'B', to: 'D', relation: 'CALLS', resolution: 'EXACT' },
      { id: 'e3', from: 'A', to: 'C', relation: 'CALLS', resolution: 'EXACT' },
      { id: 'e4', from: 'C', to: 'D', relation: 'CALLS', resolution: 'EXACT' },
    ],
    { maxPaths: 1 },
  );
  assert.equal(pathLimited.completeness, 'PARTIAL');
  assert.match(pathLimited.diagnostics.join(' '), /maxPaths/);
});

test('evidence snapshot replay is idempotent and a new revision gets a separate immutable snapshot', async () => {
  const repository = new MemoryEvidenceRepository();
  const firstInput = {
    snapshot: {
      organizationId: 'org-a',
      findingId: 'finding-a',
      findingOccurrenceId: 'occurrence-commit-a',
      analysisRunId: 'run-a',
      repositoryId: 'repo-a',
      commitId: 'commit-a',
      identityFingerprint: 'fact-a',
      authority: 'AUTHORITATIVE' as const,
      origin: 'DETERMINISTIC_ANALYZER' as const,
      sufficiency: 'SUFFICIENT' as const,
      completeness: 'COMPLETE' as const,
      diagnostics: [],
      analyzerVersions: { analyzer: '1.0.0' },
      paths: [{
        id: 'path-a',
        nodeIds: ['entity:a'],
        edgeIds: [],
        completeness: 'COMPLETE' as const,
        diagnostics: [],
      }],
    },
    nodes: [{
      organizationId: 'org-a',
      nodeKey: 'entity:a',
      nodeType: 'FUNCTION' as const,
      label: 'A',
      filePath: 'src/a.ts',
      line: 10,
      endLine: 20,
      attributes: {
        sourceEntityId: 'entity-a',
        findingId: 'finding-a',
        authority: 'AUTHORITATIVE',
        confidence: 'HIGH',
        provenance: 'STATIC_ANALYZER',
      },
    }],
    edges: [],
  };

  const first = await repository.createGraph(firstInput);
  const replay = await repository.createGraph(firstInput);
  assert.equal(first.created, true);
  assert.equal(replay.created, false);
  assert.equal(repository.graphs.size, 1);
  assert.equal(replay.graph.snapshot.authority, 'AUTHORITATIVE');
  assert.equal(replay.graph.snapshot.origin, 'DETERMINISTIC_ANALYZER');
  assert.equal(replay.graph.nodes[0]?.file_path, 'src/a.ts');
  assert.equal(replay.graph.nodes[0]?.line, 10);
  assert.equal(replay.graph.nodes[0]?.end_line, 20);

  const nextCommit = await repository.createGraph({
    ...firstInput,
    snapshot: {
      ...firstInput.snapshot,
      findingOccurrenceId: 'occurrence-commit-b',
      analysisRunId: 'run-b',
      commitId: 'commit-b',
    },
  });
  assert.equal(nextCommit.created, true);
  assert.equal(repository.graphs.size, 2);
  assert.equal(first.graph.snapshot.commit_id, 'commit-a');
  assert.equal(first.graph.snapshot.analysis_run_id, 'run-a');
  assert.equal(first.graph.snapshot.complete, true);
});

test('structural evidence excludes unresolved calls and marks the snapshot partial and unknown', () => {
  const target: CodeEntityRecord = {
    id: 'function-a',
    organization_id: 'org-a',
    repository_id: 'repo-a',
    commit_id: 'commit-a',
    entity_key: 'function-a',
    entity_type: 'FUNCTION',
    name: 'handler',
    qualified_name: 'src/a.ts::handler',
    file_path: 'src/a.ts',
    start_line: 1,
    end_line: 30,
    provenance: {},
    created_at: '',
  };
  const exactCallees: CodeEntityRecord[] = Array.from({ length: 16 }, (_, index) => ({
    ...target,
    id: `callee-${index}`,
    entity_key: `callee-${index}`,
    name: `callee${index}`,
    qualified_name: `src/a.ts::callee${index}`,
    start_line: 40 + index,
    end_line: 45 + index,
  }));
  const relationships: CodeRelationshipRecord[] = exactCallees.map((callee, index) => ({
    id: `call-${index}`,
    organization_id: 'org-a',
    repository_id: 'repo-a',
    commit_id: 'commit-a',
    source_entity_id: target.id,
    target_entity_id: callee.id,
    relation: 'CALLS',
    resolution: 'EXACT',
    confidence: 'HIGH',
    provenance: {},
    created_at: '',
  }));
  relationships.push({
    ...relationships[0],
    id: 'unresolved-call',
    target_entity_id: 'missing-target',
    resolution: 'UNKNOWN',
  });
  const entities = [target, ...exactCallees];
  const intelligence: RepositoryIntelligenceSnapshot = {
    organizationId: 'org-a',
    repositoryId: 'repo-a',
    commitId: 'commit-a',
    status: 'COMPLETE',
    entities,
    relationships,
    dependencies: [],
    dependencyEdges: [],
    entityIndex: new Map(entities.map((entity) => [entity.id, entity])),
    outgoingRelationships: new Map(),
    incomingRelationships: new Map(),
    createdAt: '',
    irVersion: 'test',
  };
  const candidate: FindingCandidate = {
    ruleId: 'HIGH_FAN_OUT',
    ruleVersion: '1.0.0',
    title: 'High fan out',
    description: 'More than 15 exact outgoing calls',
    category: 'STRUCTURAL',
    severity: 'MEDIUM',
    confidence: 'HIGH',
    repositoryId: 'repo-a',
    commitId: 'commit-a',
    file: 'src/a.ts',
    startLine: 1,
    endLine: 30,
    semanticTarget: 'src/a.ts::handler',
    evidenceInputs: { fanOut: 16, configuredThreshold: 15 },
    fingerprintInputs: { fanOut: 16 },
  };

  const graph = buildFindingEvidenceGraph('finding-a', candidate, intelligence);
  assert.equal(graph.edges.length, 16);
  assert.equal(graph.edges.every((edge) => edge.resolution === 'EXACT'), true);
  assert.equal(graph.completeness, 'PARTIAL');
  assert.equal(graph.sufficiency, 'UNKNOWN');
  assert.match(graph.diagnostics.join(' '), /Unresolved call relationships/);

  const timedOutGraph = buildFindingEvidenceGraph('finding-a', candidate, intelligence, { maxDurationMs: 0 });
  assert.equal(timedOutGraph.completeness, 'PARTIAL');
  assert.equal(timedOutGraph.sufficiency, 'UNKNOWN');
  assert.equal(timedOutGraph.edges.length, 0);
  assert.match(timedOutGraph.diagnostics.join(' '), /maxDurationMs/);
});
