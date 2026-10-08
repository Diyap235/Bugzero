import {
  CodeEntityRepository,
  CodeRelationshipRepository,
  DependencyRepository,
  type CodeEntityRecord,
  type CodeRelationshipRecord,
} from '@bugzero/database';

import type { RepositoryIntelligenceBuildOptions, RepositoryIntelligenceSnapshot } from './types.js';

export class RepositoryIntelligenceBuilder {
  constructor(
    private readonly entityRepository = new CodeEntityRepository(),
    private readonly relationshipRepository = new CodeRelationshipRepository(),
    private readonly dependencyRepository = new DependencyRepository(),
  ) {}

  async build(organizationId: string, repositoryId: string, commitId: string, options: RepositoryIntelligenceBuildOptions = {}): Promise<RepositoryIntelligenceSnapshot> {
    const irVersion = options.irVersion ?? 'bugzero-ir-v1';
    const [entities, relationships, dependencies] = await Promise.all([
      this.entityRepository.listByCommit(organizationId, repositoryId, commitId),
      this.relationshipRepository.listByCommit(organizationId, repositoryId, commitId),
      this.dependencyRepository.listByCommit(organizationId, repositoryId, commitId),
    ]);

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

    const dependencyEdges = await this.dependencyRepository.listEdgesByCommit(organizationId, repositoryId, commitId);

    const status: RepositoryIntelligenceSnapshot['status'] = entities.length === 0 && dependencies.length === 0 ? 'FAILED' : 'COMPLETE';

    return {
      organizationId,
      repositoryId,
      commitId,
      status,
      entities,
      relationships,
      dependencies,
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

export const repositoryIntelligenceBuilder = new RepositoryIntelligenceBuilder();
