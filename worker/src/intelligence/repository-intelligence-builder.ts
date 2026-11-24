import type {
  CodeEntityRecord,
  CodeRelationshipRecord,
  DependencyEdgeRecord,
  DependencyRecord,
} from '@bugzero/database';

import { CodeGraphRepository, codeGraphRepository } from '../graph/code-graph.repository.js';
import type {
  DependencyRelationship,
  RepositoryIntelligenceBuildOptions,
  RepositoryIntelligenceSnapshot,
} from './types.js';

export class RepositoryIntelligenceBuilder {
  constructor(
    private readonly graphRepository: Pick<CodeGraphRepository, 'listByRun'> = codeGraphRepository,
  ) {}

  async build(
    organizationId: string,
    repositoryId: string,
    commitId: string,
    analysisRunId: string,
    options: RepositoryIntelligenceBuildOptions = {},
  ): Promise<RepositoryIntelligenceSnapshot> {
    const irVersion = options.irVersion ?? 'bugzero-ir-v1';
    const graph = await this.graphRepository.listByRun({ organizationId, repositoryId, commitId, analysisRunId });
    const { entities, relationships } = graph;

    const outgoingRelationships = new Map<string, CodeRelationshipRecord[]>();
    const incomingRelationships = new Map<string, CodeRelationshipRecord[]>();
    const entityIndex = new Map<string, CodeEntityRecord>();

    for (const entity of entities) {
      entityIndex.set(entity.id, entity);
    }

    for (const relationship of relationships) {
      const outgoing = outgoingRelationships.get(relationship.source_entity_id) ?? [];
      outgoing.push(relationship);
      outgoingRelationships.set(relationship.source_entity_id, outgoing);

      const incoming = incomingRelationships.get(relationship.target_entity_id) ?? [];
      incoming.push(relationship);
      incomingRelationships.set(relationship.target_entity_id, incoming);
    }

    const dependencies = entities
      .filter((entity) => entity.entity_type === 'DEPENDENCY')
      .map(dependencyRecord);
    const dependencyRelationships: DependencyRelationship[] = dependencies.map((dependency) => ({
      dependencyId: dependency.id,
      packageName: dependency.package_name,
      relationship: dependency.direct ? 'DIRECT' : 'TRANSITIVE',
      direct: dependency.direct,
      resolution: 'UNKNOWN',
    }));
    const dependencyIds = new Set(dependencies.map((dependency) => dependency.id));
    const dependencyEdgesByIdentity = new Map<string, DependencyEdgeRecord>();
    for (const edge of graph.dependencyEdges ?? []) {
      if (!dependencyIds.has(edge.from_dependency_id) || !dependencyIds.has(edge.to_dependency_id)) {
        throw new Error(`Persisted dependency edge ${edge.id} references an unavailable dependency`);
      }
      dependencyEdgesByIdentity.set(
        JSON.stringify([edge.from_dependency_id, edge.to_dependency_id, edge.relationship]),
        edge,
      );
    }
    for (const relationship of relationships
      .filter((relationship) => relationship.relation === 'DEPENDS_ON'
        && dependencyIds.has(relationship.source_entity_id)
        && dependencyIds.has(relationship.target_entity_id))) {
      const edge = dependencyEdgeRecord(relationship);
      const identity = JSON.stringify([edge.from_dependency_id, edge.to_dependency_id, edge.relationship]);
      if (!dependencyEdgesByIdentity.has(identity)) dependencyEdgesByIdentity.set(identity, edge);
    }
    const dependencyEdges = [...dependencyEdgesByIdentity.values()];

    const status: RepositoryIntelligenceSnapshot['status'] = entities.length === 0 && dependencies.length === 0 ? 'FAILED' : 'COMPLETE';

    return {
      organizationId,
      repositoryId,
      commitId,
      status,
      entities,
      relationships,
      dependencies,
      dependencyRelationships,
      dependencyEdges,
      entityIndex,
      outgoingRelationships,
      incomingRelationships,
      createdAt: new Date().toISOString(),
      irVersion,
    };
  }

  getEntity(snapshot: RepositoryIntelligenceSnapshot, entityId: string): CodeEntityRecord | undefined {
    return snapshot.entityIndex.get(entityId);
  }

  findEntityByQualifiedName(snapshot: RepositoryIntelligenceSnapshot, qualifiedName: string): CodeEntityRecord | undefined {
    return snapshot.entities.find((entity) => entity.qualified_name === qualifiedName);
  }

  findEntitiesByFile(snapshot: RepositoryIntelligenceSnapshot, filePath: string): CodeEntityRecord[] {
    return snapshot.entities.filter((entity) => entity.file_path === filePath);
  }

  findEntitiesByKind(snapshot: RepositoryIntelligenceSnapshot, entityType: string): CodeEntityRecord[] {
    return snapshot.entities.filter((entity) => entity.entity_type === entityType);
  }

  getCallers(snapshot: RepositoryIntelligenceSnapshot, entityId: string): CodeRelationshipRecord[] {
    return (snapshot.incomingRelationships.get(entityId) ?? []).filter((relationship) => relationship.relation === 'CALLS');
  }

  getCallees(snapshot: RepositoryIntelligenceSnapshot, entityId: string): CodeRelationshipRecord[] {
    return (snapshot.outgoingRelationships.get(entityId) ?? []).filter((relationship) => relationship.relation === 'CALLS');
  }

  getImports(snapshot: RepositoryIntelligenceSnapshot, entityId: string): CodeRelationshipRecord[] {
    return (snapshot.outgoingRelationships.get(entityId) ?? []).filter((relationship) => relationship.relation === 'IMPORTS');
  }

  getImporters(snapshot: RepositoryIntelligenceSnapshot, entityId: string): CodeRelationshipRecord[] {
    return (snapshot.incomingRelationships.get(entityId) ?? []).filter((relationship) => relationship.relation === 'IMPORTS');
  }

  getReferences(snapshot: RepositoryIntelligenceSnapshot, entityId: string): CodeRelationshipRecord[] {
    return (snapshot.outgoingRelationships.get(entityId) ?? []).filter((relationship) => relationship.relation === 'REFERENCES');
  }

  getReverseReferences(snapshot: RepositoryIntelligenceSnapshot, entityId: string): CodeRelationshipRecord[] {
    return (snapshot.incomingRelationships.get(entityId) ?? []).filter((relationship) => relationship.relation === 'REFERENCES');
  }
}

function dependencyRecord(entity: CodeEntityRecord): DependencyRecord {
  const packageManager = entity.provenance.packageManager;
  const versionRange = entity.provenance.versionRange;
  const rawVersionConstraints = entity.provenance.versionConstraints;
  const rawExtras = entity.provenance.extras;
  const direct = entity.provenance.direct;
  if (typeof packageManager !== 'string' || typeof direct !== 'boolean' || entity.file_path === null) {
    throw new Error(`Code graph dependency ${entity.id} has incomplete manifest metadata`);
  }
  if (versionRange !== null && versionRange !== undefined && typeof versionRange !== 'string') {
    throw new Error(`Code graph dependency ${entity.id} has an invalid version range`);
  }
  const versionConstraints = rawVersionConstraints === undefined
    ? typeof versionRange === 'string' ? [versionRange] : []
    : isVersionConstraintArray(rawVersionConstraints)
      ? rawVersionConstraints
      : null;
  if (versionConstraints === null) {
    throw new Error(`Code graph dependency ${entity.id} has invalid version constraints`);
  }
  const extras = rawExtras === undefined
    ? []
    : isStringArray(rawExtras) ? rawExtras : null;
  if (extras === null) {
    throw new Error(`Code graph dependency ${entity.id} has invalid extras`);
  }
  return {
    id: entity.id,
    organization_id: entity.organization_id,
    repository_id: entity.repository_id,
    commit_id: entity.commit_id,
    package_manager: packageManager,
    package_name: entity.name,
    version: typeof versionRange === 'string' ? versionRange : null,
    version_constraints: versionConstraints,
    extras,
    manifest_path: entity.file_path,
    direct,
    created_at: entity.created_at,
  };
}

function isVersionConstraintArray(value: unknown): value is Array<string | null> {
  return Array.isArray(value) && value.every((constraint) => constraint === null || typeof constraint === 'string');
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function dependencyEdgeRecord(relationship: CodeRelationshipRecord): DependencyEdgeRecord {
  const kind = relationship.provenance.dependencyKind;
  const supportedKinds: DependencyEdgeRecord['relationship'][] = [
    'DEPENDS_ON', 'OPTIONAL_DEPENDENCY', 'PEER_DEPENDENCY',
  ];
  if (kind !== undefined && (typeof kind !== 'string' || !supportedKinds.includes(kind as DependencyEdgeRecord['relationship']))) {
    throw new Error(`Code graph dependency relationship ${relationship.id} has an invalid dependency kind`);
  }
  return {
    id: relationship.id,
    organization_id: relationship.organization_id,
    repository_id: relationship.repository_id,
    commit_id: relationship.commit_id,
    from_dependency_id: relationship.source_entity_id,
    to_dependency_id: relationship.target_entity_id,
    relationship: typeof kind === 'string' ? kind as DependencyEdgeRecord['relationship'] : 'DEPENDS_ON',
    resolution: relationship.resolution,
    created_at: relationship.created_at,
  };
}

export const repositoryIntelligenceBuilder = new RepositoryIntelligenceBuilder();
