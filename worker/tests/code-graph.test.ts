import test from 'node:test';
import assert from 'node:assert/strict';

import type { Pool } from 'pg';
import type { CodeEntityRecord, CodeRelationshipRecord, DependencyEdgeRecord } from '@bugzero/database';
import type { FindingCandidate } from '../src/analyzers/types.js';

import {
  CodeGraphRepository,
  codeGraphEntityId,
  codeGraphRelationshipId,
  type CodeGraphScope,
} from '../src/graph/code-graph.repository.js';
import { buildDependencyGraph } from '../src/graph/dependency-graph-builder.js';
import { buildSourceToSinkRelationships } from '../src/graph/source-to-sink.js';
import { RepositoryIntelligenceBuilder } from '../src/intelligence/repository-intelligence-builder.js';

class MemoryCodeGraphDatabase {
  readonly calls: Array<{ query: string; parameters: unknown[] }> = [];
  readonly entities = new Map<string, Record<string, unknown>>();
  readonly relationships = new Map<string, Record<string, unknown>>();
  readonly dataFlows = new Map<string, Record<string, unknown>>();
  readonly dependencies = new Map<string, Record<string, unknown>>();
  readonly dependencyEdges = new Map<string, Record<string, unknown>>();
  failEntityWrite = false;
  readonly pool: Pool;

  constructor() {
    const client = {
      query: (query: string, parameters: unknown[] = []) => this.run(query, parameters),
      release: () => undefined,
    };
    this.pool = { connect: async () => client } as unknown as Pool;
  }

  private async run(
    query: string,
    parameters: unknown[],
  ): Promise<{ rows: Record<string, unknown>[]; rowCount: number }> {
    this.calls.push({ query, parameters });
    if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(query.trim())) return { rows: [], rowCount: 0 };
    if (query.includes('set_config')) return { rows: [], rowCount: 1 };
    if (query.includes('INSERT INTO code_entities')) {
      if (this.failEntityWrite) throw new Error('graph write failed');
      return this.insertRows(parameters, this.entities);
    }
    if (query.includes('INSERT INTO code_relationships')) {
      return this.insertRows(parameters, this.relationships);
    }
    if (query.includes('INSERT INTO data_flow_edges')) {
      return this.insertRows(parameters, this.dataFlows);
    }
    if (query.includes('INSERT INTO dependencies')) {
      return this.insertRows(parameters, this.dependencies);
    }
    if (query.includes('INSERT INTO dependency_edges')) {
      return this.insertRows(parameters, this.dependencyEdges);
    }
    if (query.includes('FROM code_entities')) {
      return { rows: this.selected(this.entities, parameters, query.includes('analysis_run_id IS NULL')), rowCount: 0 };
    }
    if (query.includes('FROM code_relationships')) {
      return { rows: this.selected(this.relationships, parameters, query.includes('analysis_run_id IS NULL')), rowCount: 0 };
    }
    if (query.includes('FROM data_flow_edges')) {
      const rows = this.selected(this.dataFlows, parameters).map((row) => ({
        ...row,
        relation: 'DATA_FLOWS_TO',
      }));
      return { rows, rowCount: 0 };
    }
    if (query.includes('FROM dependencies')) {
      return { rows: this.selected(this.dependencies, parameters, true), rowCount: 0 };
    }
    if (query.includes('FROM dependency_edges')) {
      return { rows: this.selected(this.dependencyEdges, parameters, query.includes('analysis_run_id IS NULL')), rowCount: 0 };
    }
    return { rows: [], rowCount: 0 };
  }

  private insertRows(
    parameters: unknown[],
    target: Map<string, Record<string, unknown>>,
  ): { rows: Record<string, unknown>[]; rowCount: number } {
    const rows = JSON.parse(String(parameters[0])) as Array<Record<string, unknown>>;
    for (const row of rows) target.set(String(row.id), row);
    return { rows: [], rowCount: rows.length };
  }

  private selected(
    source: Map<string, Record<string, unknown>>,
    parameters: unknown[],
    legacyOnly = false,
  ): Record<string, unknown>[] {
    return Array.from(source.values()).filter((row) =>
      row.organization_id === parameters[0]
      && row.repository_id === parameters[1]
      && row.commit_id === parameters[2]
      && (legacyOnly
        ? row.analysis_run_id === null || row.analysis_run_id === undefined
        : row.analysis_run_id === parameters[3]));
  }
}

const scope: CodeGraphScope = {
  organizationId: '11111111-1111-4111-8111-111111111111',
  repositoryId: '22222222-2222-4222-8222-222222222222',
  commitId: '33333333-3333-4333-8333-333333333333',
  analysisRunId: '44444444-4444-4444-8444-444444444444',
};

function makeDependencyEdge(overrides: Partial<DependencyEdgeRecord> = {}): DependencyEdgeRecord {
  return {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    organization_id: scope.organizationId,
    repository_id: scope.repositoryId,
    commit_id: scope.commitId,
    from_dependency_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    to_dependency_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    relationship: 'DEPENDS_ON',
    resolution: 'EXACT',
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function buildSnapshot(): { entities: CodeEntityRecord[]; relationships: CodeRelationshipRecord[] } {
  const sourceId = codeGraphEntityId(scope, 'src/a.ts::source');
  const targetId = codeGraphEntityId(scope, 'src/a.ts::sink');
  const entities: CodeEntityRecord[] = [
    {
      id: sourceId,
      organization_id: scope.organizationId,
      repository_id: scope.repositoryId,
      commit_id: scope.commitId,
      analysis_run_id: scope.analysisRunId,
      entity_key: 'src/a.ts::source',
      entity_type: 'FUNCTION',
      name: 'source',
      qualified_name: 'src/a.ts::source',
      file_path: 'src/a.ts',
      start_line: 1,
      end_line: 4,
      provenance: { parserVersion: 'test' },
      created_at: '2026-01-01T00:00:00.000Z',
    },
    {
      id: targetId,
      organization_id: scope.organizationId,
      repository_id: scope.repositoryId,
      commit_id: scope.commitId,
      analysis_run_id: scope.analysisRunId,
      entity_key: 'src/a.ts::sink',
      entity_type: 'FUNCTION',
      name: 'sink',
      qualified_name: 'src/a.ts::sink',
      file_path: 'src/a.ts',
      start_line: 6,
      end_line: 9,
      provenance: { parserVersion: 'test' },
      created_at: '2026-01-01T00:00:00.000Z',
    },
  ];
  const relationships: CodeRelationshipRecord[] = [{
    id: codeGraphRelationshipId(scope, sourceId, 'CALLS', targetId),
    organization_id: scope.organizationId,
    repository_id: scope.repositoryId,
    commit_id: scope.commitId,
    analysis_run_id: scope.analysisRunId,
    source_entity_id: sourceId,
    target_entity_id: targetId,
    relation: 'CALLS',
    resolution: 'EXACT',
    confidence: 'HIGH',
    provenance: { parserVersion: 'test' },
    created_at: '2026-01-01T00:00:00.000Z',
  }];
  return { entities, relationships };
}

test('PostgreSQL code graph writes are run-scoped, batched and idempotent across retries', async () => {
  const database = new MemoryCodeGraphDatabase();
  const repository = new CodeGraphRepository(database.pool);
  const snapshot = buildSnapshot();

  assert.equal(
    codeGraphEntityId(scope, 'src/a.ts::source'),
    codeGraphEntityId(scope, 'src/a.ts::source'),
  );
  assert.notEqual(
    codeGraphEntityId(scope, 'src/a.ts::source'),
    codeGraphEntityId({ ...scope, analysisRunId: '55555555-5555-4555-8555-555555555555' }, 'src/a.ts::source'),
  );

  await repository.writeSnapshot(scope, snapshot);
  await repository.writeSnapshot(scope, snapshot);

  const loaded = await repository.listByRun(scope);
  assert.equal(loaded.entities.length, 2);
  assert.equal(loaded.relationships.length, 1);
  assert.deepEqual(loaded.entities[0]?.provenance, { parserVersion: 'test' });
  assert.equal(loaded.relationships[0]?.relation, 'CALLS');
  const postgresEntityWrites = database.calls.filter(({ query }) => query.includes('INSERT INTO code_entities'));
  assert.equal(postgresEntityWrites.length, 2);
  assert.ok(postgresEntityWrites.every(({ query, parameters }) =>
    query.includes('ON CONFLICT')
    && query.includes('analysis_run_id IS NOT NULL')
    && (JSON.parse(String(parameters[0])) as Array<Record<string, unknown>>)
      .every((row) => row.organization_id === scope.organizationId
        && row.repository_id === scope.repositoryId
        && row.commit_id === scope.commitId
        && row.analysis_run_id === scope.analysisRunId)));
  assert.ok(database.calls.some(({ query }) =>
    query.includes('FROM code_entities')
    && query.includes('organization_id = $1')
    && query.includes('analysis_run_id = $4')));
  assert.equal(database.entities.size, 2);
  assert.equal(database.relationships.size, 1);
});

test('code graph upserts deduplicate repeated logical code and data-flow edges within each batch', async () => {
  const database = new MemoryCodeGraphDatabase();
  const repository = new CodeGraphRepository(database.pool);
  const snapshot = buildSnapshot();
  const [source, target] = snapshot.entities;
  assert.ok(source && target);
  const codeRelationship = snapshot.relationships[0]!;
  const dataFlow: CodeRelationshipRecord = {
    ...codeRelationship,
    id: codeGraphRelationshipId(scope, source.id, 'DATA_FLOWS_TO:SQL_INJECTION:path-1', target.id),
    relation: 'DATA_FLOWS_TO',
    provenance: { ruleId: 'SQL_INJECTION', evidencePathId: 'path-1' },
  };

  await repository.writeSnapshot(scope, {
    ...snapshot,
    relationships: [codeRelationship, { ...codeRelationship }, dataFlow, { ...dataFlow }],
  });

  const codeWrite = database.calls.find(({ query }) => query.includes('INSERT INTO code_relationships'));
  const flowWrite = database.calls.find(({ query }) => query.includes('INSERT INTO data_flow_edges'));
  assert.ok(codeWrite && flowWrite);
  assert.equal((JSON.parse(String(codeWrite.parameters[0])) as unknown[]).length, 1);
  assert.equal((JSON.parse(String(flowWrite.parameters[0])) as unknown[]).length, 1);
  assert.equal(database.relationships.size, 1);
  assert.equal(database.dataFlows.size, 1);
});

test('code graph rejects foreign-scope rows, missing endpoints, and failed writes', async () => {
  const database = new MemoryCodeGraphDatabase();
  const repository = new CodeGraphRepository(database.pool);
  const snapshot = buildSnapshot();
  await assert.rejects(repository.writeSnapshot({ ...scope, organizationId: '99999999-9999-4999-8999-999999999999' }, snapshot), /scope/);
  await assert.rejects(repository.writeSnapshot(scope, {
    entities: snapshot.entities,
    relationships: [{ ...snapshot.relationships[0]!, target_entity_id: 'missing' }],
  }), /endpoint is missing/);
  assert.equal(database.calls.length, 0);

  database.failEntityWrite = true;
  await assert.rejects(repository.writeSnapshot(scope, snapshot), /graph write failed/);
});

test('code graph rejects malformed persisted records', async () => {
  const database = new MemoryCodeGraphDatabase();
  const repository = new CodeGraphRepository(database.pool);
  await repository.writeSnapshot(scope, buildSnapshot());
  const firstEntity = database.entities.values().next().value as Record<string, unknown>;
  firstEntity.start_line = 'not-a-line-number';
  await assert.rejects(repository.listByRun(scope), /invalid line number/);
});

test('dependency edges persist and read back only when explicitly supplied', async () => {
  const database = new MemoryCodeGraphDatabase();
  const repository = new CodeGraphRepository(database.pool);
  const graph = buildDependencyGraph(scope, [{
    path: 'package.json',
    content: JSON.stringify({ dependencies: { left: '1.0.0', right: '2.0.0' } }),
  }], 10);
  const dependencies = graph.entities.filter((entity) => entity.entity_type === 'DEPENDENCY');
  assert.equal(dependencies.length, 2);
  const from = dependencies[0]!;
  const to = dependencies[1]!;

  await repository.writeSnapshot(scope, graph);
  const callsBeforeCreate = database.calls.length;
  const created = await repository.createDependencyEdge({
    ...scope,
    fromDependencyId: from.id,
    toDependencyId: to.id,
    relationship: 'OPTIONAL_DEPENDENCY',
    resolution: 'EXACT',
  });
  const createCalls = database.calls.slice(callsBeforeCreate);

  assert.match(created.id, /^[0-9a-f-]{36}$/);
  assert.equal(createCalls.filter(({ query }) => query.trim() === 'BEGIN').length, 1);
  assert.equal(createCalls.filter(({ query }) => query.includes('FROM dependency_edges')).length, 1);
  assert.equal(createCalls.filter(({ query }) => query.trim() === 'COMMIT').length, 1);
  assert.deepEqual(await repository.listDependencyEdgesByRun(scope), [created]);
  assert.deepEqual((await repository.listByRun(scope)).dependencyEdges, [created]);
  const persisted = database.dependencyEdges.get(created.id);
  assert.equal(persisted?.analysis_run_id, scope.analysisRunId);

  const intelligence = await new RepositoryIntelligenceBuilder(repository).build(
    scope.organizationId,
    scope.repositoryId,
    scope.commitId,
    scope.analysisRunId,
  );
  assert.deepEqual(intelligence.dependencyEdges, [created]);
});

test('dependency-edge batches safely collapse identical duplicate IDs and payloads', async () => {
  const database = new MemoryCodeGraphDatabase();
  const repository = new CodeGraphRepository(database.pool);
  const edge = makeDependencyEdge();

  await repository.writeDependencyEdges(scope, [edge, { ...edge }]);

  const write = database.calls.find(({ query }) => query.includes('INSERT INTO dependency_edges'));
  assert.ok(write);
  assert.equal((JSON.parse(String(write.parameters[0])) as unknown[]).length, 1);
  assert.equal(database.dependencyEdges.size, 1);
});

test('dependency-edge batches reject a repeated ID with conflicting endpoints, relationship, or resolution', async () => {
  const edge = makeDependencyEdge();
  const conflicts = [
    { ...edge, from_dependency_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' },
    { ...edge, to_dependency_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' },
    { ...edge, relationship: 'OPTIONAL_DEPENDENCY' as const },
    { ...edge, resolution: 'POSSIBLE' as const },
  ];

  for (const conflict of conflicts) {
    const database = new MemoryCodeGraphDatabase();
    const repository = new CodeGraphRepository(database.pool);
    await assert.rejects(
      repository.writeDependencyEdges(scope, [edge, conflict]),
      /Duplicate dependency edge ID has conflicting payloads/,
    );
    assert.equal(database.calls.length, 0);
    assert.equal(database.dependencyEdges.size, 0);
  }
});

test('dependency-edge batches retain valid distinct edges', async () => {
  const database = new MemoryCodeGraphDatabase();
  const repository = new CodeGraphRepository(database.pool);
  const first = makeDependencyEdge();
  const second = makeDependencyEdge({
    id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    to_dependency_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  });

  await repository.writeDependencyEdges(scope, [first, second]);

  assert.equal(database.dependencyEdges.size, 2);
  assert.deepEqual(
    Array.from(database.dependencyEdges.values()).map((edge) => edge.id),
    [first.id, second.id],
  );
});

test('legacy graph rows with null run IDs remain readable without entering run-scoped results', async () => {
  const database = new MemoryCodeGraphDatabase();
  const repository = new CodeGraphRepository(database.pool);
  const { entities, relationships } = buildSnapshot();
  const legacyEntityId = entities[0]!.id;
  const legacyEntity: Record<string, unknown> = { ...entities[0]!, analysis_run_id: null };
  const currentEntity = entities[1]!;
  const legacyRelationshipId = relationships[0]!.id;
  const legacyRelationship: Record<string, unknown> = { ...relationships[0]!, analysis_run_id: null };
  const legacyDependency = {
    id: '66666666-6666-4666-8666-666666666666',
    organization_id: scope.organizationId,
    repository_id: scope.repositoryId,
    commit_id: scope.commitId,
    analysis_run_id: null,
    package_manager: 'npm',
    package_name: 'legacy-package',
    version: '1.0.0',
    manifest_path: 'package.json',
    direct: true,
    created_at: '2026-01-01T00:00:00.000Z',
  };
  const legacyEdge = {
    id: '77777777-7777-4777-8777-777777777777',
    organization_id: scope.organizationId,
    repository_id: scope.repositoryId,
    commit_id: scope.commitId,
    analysis_run_id: null,
    from_dependency_id: legacyDependency.id,
    to_dependency_id: '88888888-8888-4888-8888-888888888888',
    relationship: 'DEPENDS_ON',
    resolution: 'UNKNOWN',
    created_at: '2026-01-01T00:00:00.000Z',
  };
  database.entities.set(legacyEntityId, legacyEntity);
  database.entities.set(currentEntity.id, { ...currentEntity });
  database.relationships.set(legacyRelationshipId, legacyRelationship);
  database.dependencies.set(legacyDependency.id, legacyDependency);
  database.dependencyEdges.set(legacyEdge.id, legacyEdge);

  const legacy = await repository.listLegacyByCommit({
    organizationId: scope.organizationId,
    repositoryId: scope.repositoryId,
    commitId: scope.commitId,
  });
  assert.equal(legacy.entities.length, 1);
  assert.equal(legacy.entities[0]?.analysis_run_id, undefined);
  assert.equal(legacy.relationships.length, 1);
  assert.equal(legacy.relationships[0]?.analysis_run_id, undefined);
  assert.equal(legacy.dependencies[0]?.package_name, 'legacy-package');
  assert.equal(legacy.dependencyEdges[0]?.id, legacyEdge.id);

  const runSnapshot = await repository.listByRun(scope);
  assert.deepEqual(runSnapshot.entities.map((entity) => entity.id), [currentEntity.id]);
  assert.deepEqual(runSnapshot.relationships, []);
  assert.deepEqual(runSnapshot.dependencyEdges, []);
  assert.equal(database.calls.some(({ query }) => query.startsWith('INSERT INTO')), false);
  assert.equal(database.entities.get(legacyEntityId)?.analysis_run_id, null);
});

test('complete authoritative source-to-sink evidence becomes a run-scoped graph relation', async () => {
  const snapshot = buildSnapshot();
  const sourceEntityId = snapshot.entities[0]!.id;
  const sinkEntityId = snapshot.entities[1]!.id;
  const candidate: FindingCandidate = {
    ruleId: 'SQL_INJECTION',
    ruleVersion: '1',
    title: 'SQL injection',
    description: 'Untrusted input reaches a SQL sink',
    category: 'SECURITY',
    severity: 'HIGH',
    confidence: 'HIGH',
    repositoryId: scope.repositoryId,
    commitId: scope.commitId,
    file: 'src/a.ts',
    startLine: 1,
    endLine: 9,
    semanticTarget: 'src/a.ts::sink',
    evidenceInputs: {},
    fingerprintInputs: {},
    evidenceGraph: {
      nodes: [
        {
          nodeKey: 'source-node',
          nodeType: 'SOURCE',
          label: 'request.query',
          filePath: 'src/a.ts',
          line: 1,
          attributes: { sourceEntityId },
        },
        {
          nodeKey: 'sink-node',
          nodeType: 'SINK',
          label: 'db.query',
          filePath: 'src/a.ts',
          line: 9,
          attributes: { sourceEntityId: sinkEntityId },
        },
      ],
      edges: [{
        edgeKey: 'flow-edge',
        fromNodeKey: 'source-node',
        toNodeKey: 'sink-node',
        relation: 'REACHES_SQL_SINK',
        resolution: 'EXACT',
        confidence: 'HIGH',
        attributes: { authority: 'AUTHORITATIVE' },
      }],
      paths: [{
        id: 'path-1',
        nodeIds: ['source-node', 'sink-node'],
        edgeIds: ['flow-edge'],
        completeness: 'COMPLETE',
        diagnostics: [],
      }],
      completeness: 'COMPLETE',
      sufficiency: 'SUFFICIENT',
      diagnostics: [],
    },
  };

  const result = buildSourceToSinkRelationships(scope, [candidate], new Set([sourceEntityId, sinkEntityId]));
  assert.equal(result.relationships.length, 1);
  assert.equal(result.relationships[0]?.relation, 'DATA_FLOWS_TO');
  assert.equal(result.relationships[0]?.source_entity_id, sourceEntityId);
  assert.equal(result.relationships[0]?.target_entity_id, sinkEntityId);
  assert.equal(result.relationships[0]?.resolution, 'EXACT');
  assert.deepEqual(result.diagnostics, []);

  const database = new MemoryCodeGraphDatabase();
  const repository = new CodeGraphRepository(database.pool);
  await repository.writeSnapshot(scope, snapshot);
  await repository.writeRelationships(scope, result.relationships);
  const loaded = await repository.listByRun(scope);
  assert.ok(loaded.relationships.some((relationship) => relationship.relation === 'DATA_FLOWS_TO'));
});

test('unlinked complete evidence remains diagnostic rather than claiming graph coverage', () => {
  const candidate: FindingCandidate = {
    ruleId: 'SQL_INJECTION',
    ruleVersion: '1',
    title: 'SQL injection',
    description: 'Untrusted input reaches a SQL sink',
    category: 'SECURITY',
    severity: 'HIGH',
    confidence: 'HIGH',
    repositoryId: scope.repositoryId,
    commitId: scope.commitId,
    file: 'src/a.ts',
    startLine: 1,
    endLine: 9,
    semanticTarget: 'src/a.ts::sink',
    evidenceInputs: {},
    fingerprintInputs: {},
    evidenceGraph: {
      nodes: [
        { nodeKey: 'source', nodeType: 'SOURCE', label: 'source', filePath: null, line: null, attributes: {} },
        { nodeKey: 'sink', nodeType: 'SINK', label: 'sink', filePath: null, line: null, attributes: {} },
      ],
      edges: [{
        edgeKey: 'flow-edge',
        fromNodeKey: 'source',
        toNodeKey: 'sink',
        relation: 'REACHES_SQL_SINK',
        resolution: 'EXACT',
        confidence: 'HIGH',
        attributes: {},
      }],
      paths: [{
        id: 'unlinked-path',
        nodeIds: ['source', 'sink'],
        edgeIds: ['flow-edge'],
        completeness: 'COMPLETE',
        diagnostics: [],
      }],
      completeness: 'COMPLETE',
      sufficiency: 'SUFFICIENT',
      diagnostics: [],
    },
  };
  const result = buildSourceToSinkRelationships(scope, [candidate], new Set());
  assert.equal(result.relationships.length, 0);
  assert.equal(result.diagnostics.length, 1);
});

test('manifest declarations remain separate from dependency-to-dependency edges', async () => {
  const result = buildDependencyGraph(scope, [
    {
      path: 'package.json',
      content: JSON.stringify({
        dependencies: { express: '^4.0.0' },
        devDependencies: { typescript: '~5.0.0' },
        peerDependencies: { react: '>=18' },
      }),
    },
    { path: 'requirements.txt', content: 'requests>=2.31\n# comment\npytest==8.0\n' },
    { path: 'requirements-dev.txt', content: 'mypy==1.10\n' },
    { path: 'package-lock.json', content: '{}' },
  ], 20);
  const dependencyEntities = result.entities.filter((entity) => entity.entity_type === 'DEPENDENCY');
  assert.equal(dependencyEntities.length, 6);
  assert.equal(result.relationships.length, 6);
  assert.ok(result.relationships.every((relationship) => relationship.relation === 'DEPENDS_ON'
    && relationship.resolution === 'UNKNOWN'));
  assert.ok(dependencyEntities.every((entity) => entity.analysis_run_id === scope.analysisRunId));
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.includes('lockfile-resolved')));

  const database = new MemoryCodeGraphDatabase();
  const repository = new CodeGraphRepository(database.pool);
  await repository.writeSnapshot(scope, result);
  const intelligence = await new RepositoryIntelligenceBuilder(repository).build(
    scope.organizationId,
    scope.repositoryId,
    scope.commitId,
    scope.analysisRunId,
  );
  assert.equal(intelligence.dependencies.length, 6);
  assert.equal(intelligence.dependencyRelationships.length, 6);
  assert.equal(intelligence.dependencyEdges.length, 0);
  assert.ok(intelligence.dependencyRelationships.every((relationship) => relationship.direct
    && relationship.relationship === 'DIRECT'
    && relationship.resolution === 'UNKNOWN'));
  assert.ok(intelligence.dependencies.some((dependency) => dependency.package_name === 'express'
    && dependency.package_manager === 'npm'));
  assert.ok(intelligence.dependencies.some((dependency) => dependency.package_name === 'requests'
    && dependency.package_manager === 'pip'));
  assert.ok(intelligence.dependencies.some((dependency) => dependency.package_name === 'mypy'
    && dependency.manifest_path === 'requirements-dev.txt'));
});

test('duplicate requirements are deduplicated and conflicting constraints remain unresolved', async () => {
  const result = buildDependencyGraph(scope, [{
    path: 'requirements.txt',
    content: 'Requests[security]>=2.31\nrequests[test]>=2.31\nrequests[security]>=2.31\nurllib3<2\nurllib3>=2\n',
  }], 10);
  const dependencyEntities = result.entities.filter((entity) => entity.entity_type === 'DEPENDENCY');
  assert.equal(dependencyEntities.length, 2);
  assert.equal(result.relationships.length, 2);
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.includes('conflicting version constraints')));

  const database = new MemoryCodeGraphDatabase();
  const repository = new CodeGraphRepository(database.pool);
  await repository.writeSnapshot(scope, result);
  const intelligence = await new RepositoryIntelligenceBuilder(repository).build(
    scope.organizationId,
    scope.repositoryId,
    scope.commitId,
    scope.analysisRunId,
  );
  const requests = intelligence.dependencies.find((dependency) => dependency.package_name === 'Requests');
  const urllib3 = intelligence.dependencies.find((dependency) => dependency.package_name === 'urllib3');
  assert.equal(requests?.version, '>=2.31');
  assert.deepEqual(requests?.version_constraints, ['>=2.31']);
  assert.deepEqual(requests?.extras, ['security', 'test']);
  assert.equal(urllib3?.version, null);
  assert.deepEqual(urllib3?.version_constraints, ['<2', '>=2']);
  assert.ok(intelligence.dependencyRelationships.every((relationship) => relationship.direct));
});

test('missing and unsupported dependency manifests do not create fabricated dependencies', () => {
  const missing = buildDependencyGraph(scope, [], 10);
  assert.deepEqual(missing.entities, []);
  assert.deepEqual(missing.relationships, []);
  assert.deepEqual(missing.diagnostics, []);

  const unsupported = buildDependencyGraph(scope, [
    { path: 'pyproject.toml', content: '[project]\ndependencies = ["requests"]\n' },
    { path: 'Pipfile', content: '[packages]\nrequests = "*"\n' },
  ], 10);
  assert.deepEqual(unsupported.entities, []);
  assert.deepEqual(unsupported.relationships, []);
  assert.equal(unsupported.diagnostics.length, 2);
  assert.ok(unsupported.diagnostics.every((diagnostic) => diagnostic.includes('not supported')));
});

test('invalid manifests and dependency budgets remain explicit', () => {
  const invalid = buildDependencyGraph(scope, [
    { path: 'package.json', content: '{invalid' },
    { path: '../outside/requirements.txt', content: 'safe==1.0' },
  ], 10);
  assert.equal(invalid.entities.length, 1);
  assert.equal(invalid.relationships.length, 0);
  assert.ok(invalid.diagnostics.some((diagnostic) => diagnostic.includes('invalid package.json')));
  assert.ok(invalid.diagnostics.some((diagnostic) => diagnostic.includes('invalid repository-relative')));

  const capped = buildDependencyGraph(scope, [
    { path: 'package.json', content: JSON.stringify({ dependencies: { express: '^4' } }) },
  ], 1);
  assert.equal(capped.entities.length, 1);
  assert.equal(capped.relationships.length, 0);
  assert.equal(capped.budgetExceeded, true);
  assert.ok(capped.diagnostics.some((diagnostic) => diagnostic.includes('maxEntities budget')));
});
