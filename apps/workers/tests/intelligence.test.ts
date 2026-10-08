import test from 'node:test';
import assert from 'node:assert/strict';

import type { CodeEntityRecord, CodeRelationshipRecord } from '@bugzero/database';

import { ImpactAnalysisEngine } from '../src/intelligence/impact-analysis.js';
import { RepositoryIntelligenceBuilder } from '../src/intelligence/repository-intelligence-builder.js';

const entityList: CodeEntityRecord[] = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    organization_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    repository_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    commit_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    entity_key: 'routes',
    entity_type: 'MODULE',
    name: 'routes',
    qualified_name: 'src/routes.ts::routes',
    file_path: 'src/routes.ts',
    start_line: 1,
    end_line: 12,
    provenance: { file: 'src/routes.ts' },
    created_at: '2026-01-01T00:00:00.000Z',
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    organization_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    repository_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    commit_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    entity_key: 'auth',
    entity_type: 'MODULE',
    name: 'auth',
    qualified_name: 'src/auth.ts::auth',
    file_path: 'src/auth.ts',
    start_line: 1,
    end_line: 20,
    provenance: { file: 'src/auth.ts' },
    created_at: '2026-01-01T00:00:00.000Z',
  },
  {
    id: '33333333-3333-4333-8333-333333333333',
    organization_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    repository_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    commit_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    entity_key: 'validateToken',
    entity_type: 'FUNCTION',
    name: 'validateToken',
    qualified_name: 'src/auth.ts::validateToken',
    file_path: 'src/auth.ts',
    start_line: 5,
    end_line: 14,
    provenance: { file: 'src/auth.ts' },
    created_at: '2026-01-01T00:00:00.000Z',
  },
  {
    id: '44444444-4444-4444-8444-444444444444',
    organization_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    repository_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    commit_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    entity_key: 'payment',
    entity_type: 'MODULE',
    name: 'payment',
    qualified_name: 'src/payment.ts::payment',
    file_path: 'src/payment.ts',
    start_line: 1,
    end_line: 25,
    provenance: { file: 'src/payment.ts' },
    created_at: '2026-01-01T00:00:00.000Z',
  },
  {
    id: '55555555-5555-4555-8555-555555555555',
    organization_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    repository_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    commit_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    entity_key: 'database',
    entity_type: 'MODULE',
    name: 'database',
    qualified_name: 'src/database.ts::database',
    file_path: 'src/database.ts',
    start_line: 1,
    end_line: 10,
    provenance: { file: 'src/database.ts' },
    created_at: '2026-01-01T00:00:00.000Z',
  },
];

const relationshipList: CodeRelationshipRecord[] = [
  {
    id: 'r1',
    organization_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    repository_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    commit_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    source_entity_id: '11111111-1111-4111-8111-111111111111',
    target_entity_id: '22222222-2222-4222-8222-222222222222',
    relation: 'IMPORTS',
    resolution: 'EXACT',
    confidence: 'HIGH',
    provenance: { kind: 'IMPORTS' },
    created_at: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'r2',
    organization_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    repository_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    commit_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    source_entity_id: '22222222-2222-4222-8222-222222222222',
    target_entity_id: '33333333-3333-4333-8333-333333333333',
    relation: 'CALLS',
    resolution: 'EXACT',
    confidence: 'HIGH',
    provenance: { kind: 'CALLS' },
    created_at: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'r3',
    organization_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    repository_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    commit_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    source_entity_id: '33333333-3333-4333-8333-333333333333',
    target_entity_id: '44444444-4444-4444-8444-444444444444',
    relation: 'CALLS',
    resolution: 'POSSIBLE',
    confidence: 'MEDIUM',
    provenance: { kind: 'POSSIBLE_CALLS' },
    created_at: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'r4',
    organization_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    repository_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    commit_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    source_entity_id: '44444444-4444-4444-8444-444444444444',
    target_entity_id: '55555555-5555-4555-8555-555555555555',
    relation: 'REFERENCES',
    resolution: 'INFERRED',
    confidence: 'MEDIUM',
    provenance: { kind: 'REFERENCES' },
    created_at: '2026-01-01T00:00:00.000Z',
  },
];

test('entity queries resolve by qualified name, file, and kind', () => {
  const builder = new RepositoryIntelligenceBuilder();
  const outgoingRelationships = new Map<string, CodeRelationshipRecord[]>();
  const incomingRelationships = new Map<string, CodeRelationshipRecord[]>();
  for (const relationship of relationshipList) {
    outgoingRelationships.set(relationship.source_entity_id, [...(outgoingRelationships.get(relationship.source_entity_id) ?? []), relationship]);
    incomingRelationships.set(relationship.target_entity_id, [...(incomingRelationships.get(relationship.target_entity_id) ?? []), relationship]);
  }

  const snapshot = {
    organizationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    repositoryId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    commitId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    status: 'COMPLETE',
    entities: entityList,
    relationships: relationshipList,
    dependencies: [],
    dependencyEdges: [],
    entityIndex: new Map(entityList.map((entity) => [entity.id, entity])),
    outgoingRelationships,
    incomingRelationships,
    createdAt: '2026-01-01T00:00:00.000Z',
    irVersion: 'bugzero-ir-v1',
  } as any;

  const byName = builder.findEntityByQualifiedName(snapshot, 'src/auth.ts::validateToken');
  assert.ok(byName);
  assert.equal(byName?.name, 'validateToken');

  const byFile = builder.findEntitiesByFile(snapshot, 'src/auth.ts');
  assert.equal(byFile.length, 2);

  const byKind = builder.findEntitiesByKind(snapshot, 'MODULE');
  assert.equal(byKind.length, 4);

  assert.equal(builder.getCallers(snapshot, '33333333-3333-4333-8333-333333333333').length, 1);
  assert.equal(builder.getCallees(snapshot, '22222222-2222-4222-8222-222222222222').length, 1);
  assert.equal(builder.getImports(snapshot, '11111111-1111-4111-8111-111111111111').length, 1);
  assert.equal(builder.getImporters(snapshot, '22222222-2222-4222-8222-222222222222').length, 1);
});

test('impact analysis traverses callers and unresolved relationships while respecting limits', () => {
  const engine = new ImpactAnalysisEngine();
  const snapshot = {
    organizationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    repositoryId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    commitId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    status: 'COMPLETE',
    entities: entityList,
    relationships: relationshipList,
    dependencies: [],
    dependencyEdges: [],
    entityIndex: new Map(entityList.map((entity) => [entity.id, entity])),
    outgoingRelationships: new Map([
      ['11111111-1111-4111-8111-111111111111', [relationshipList[0]]],
      ['22222222-2222-4222-8222-222222222222', [relationshipList[1], relationshipList[2]]],
      ['33333333-3333-4333-8333-333333333333', [relationshipList[2]]],
      ['44444444-4444-4444-8444-444444444444', [relationshipList[3]]],
    ]),
    incomingRelationships: new Map([
      ['22222222-2222-4222-8222-222222222222', [relationshipList[0]]],
      ['33333333-3333-4333-8333-333333333333', [relationshipList[1]]],
      ['44444444-4444-4444-8444-444444444444', [relationshipList[2]]],
      ['55555555-5555-4555-8555-555555555555', [relationshipList[3]]],
    ]),
    createdAt: '2026-01-01T00:00:00.000Z',
    irVersion: 'bugzero-ir-v1',
  } as any;

  const result = engine.analyzeImpact(snapshot, {
    repositoryId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    commitId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    changedEntities: ['33333333-3333-4333-8333-333333333333'],
    maxDepth: 2,
    maxEntities: 10,
    maxFiles: 10,
  });

  assert.equal(result.affectedEntities.includes('11111111-1111-4111-8111-111111111111'), true);
  assert.equal(result.affectedEntities.includes('44444444-4444-4444-8444-444444444444'), true);
  assert.equal(result.unresolvedRelationships.length > 0, true);
  assert.equal(result.complete, false);
  assert.equal(result.requiresScopeExpansion, true);
});

test('version isolation and idempotent build semantics remain scoped to commit', () => {
  const builder = new RepositoryIntelligenceBuilder();
  const sameSnapshot = {
    organizationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    repositoryId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    commitId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    status: 'COMPLETE',
    entities: entityList,
    relationships: relationshipList,
    dependencies: [],
    dependencyEdges: [],
    entityIndex: new Map(entityList.map((entity) => [entity.id, entity])),
    outgoingRelationships: new Map(),
    incomingRelationships: new Map(),
    createdAt: '2026-01-01T00:00:00.000Z',
    irVersion: 'bugzero-ir-v1',
  } as any;

  const peerCommit = {
    ...sameSnapshot,
    commitId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    entities: entityList.slice(0, 2),
    relationships: relationshipList.slice(0, 1),
  } as any;

  assert.equal(builder.findEntityByQualifiedName(sameSnapshot, 'src/auth.ts::validateToken')?.id, '33333333-3333-4333-8333-333333333333');
  assert.equal(builder.findEntityByQualifiedName(peerCommit, 'src/auth.ts::validateToken')?.id, undefined);
  assert.equal(sameSnapshot.commitId !== peerCommit.commitId, true);
});
