import type { CodeEntityRecord, CodeRelationshipRecord } from '@bugzero/database';

import type {
  AnalysisScopeDefinition,
  ImpactAnalysisResult,
  ImpactReason,
  ImpactReasonKind,
} from '@bugzero/contracts';

import type { RepositoryIntelligenceSnapshot } from './types.js';

export interface ImpactAnalysisOptions {
  repositoryId: string;
  commitId: string;
  changedEntities: string[];
  maxDepth?: number;
  maxEntities?: number;
  maxFiles?: number;
}

function toImpactReasonKind(relationship: CodeRelationshipRecord, direction: 'incoming' | 'outgoing'): ImpactReasonKind {
  if (relationship.relation === 'CALLS') {
    return direction === 'incoming' ? 'CALLER_OF_CHANGED_ENTITY' : 'CALLEE_OF_CHANGED_ENTITY';
  }

  if (relationship.relation === 'IMPORTS') {
    return direction === 'incoming' ? 'IMPORTER_OF_CHANGED_ENTITY' : 'IMPORTS_CHANGED_ENTITY';
  }

  if (relationship.relation === 'REFERENCES') {
    return 'REFERENCE_TO_CHANGED_ENTITY';
  }

  if (relationship.relation === 'INHERITS') {
    return 'INHERITOR_OF_CHANGED_ENTITY';
  }

  if (relationship.relation === 'IMPLEMENTS') {
    return 'IMPLEMENTER_OF_CHANGED_ENTITY';
  }

  return 'CHANGE_ENTITY';
}

export class ImpactAnalysisEngine {
  analyzeImpact(snapshot: RepositoryIntelligenceSnapshot, options: ImpactAnalysisOptions): ImpactAnalysisResult {
    const { repositoryId, commitId, changedEntities, maxDepth = 3, maxEntities = 200, maxFiles = 50 } = options;
    const entityMap = new Map<string, CodeEntityRecord>(snapshot.entities.map((entity) => [entity.id, entity]));

    const queue: Array<{ entityId: string; depth: number; reason: ImpactReasonKind; relationship?: CodeRelationshipRecord }> = [];
    const seen = new Set<string>();
    const affectedEntities = new Set<string>();
    const affectedFiles = new Set<string>();
    const reasons: ImpactReason[] = [];
    const traversedRelationships: string[] = [];
    const unresolvedRelationships: string[] = [];

    for (const changedEntityId of changedEntities) {
      if (!entityMap.has(changedEntityId)) {
        continue;
      }

      queue.push({ entityId: changedEntityId, depth: 0, reason: 'CHANGE_ENTITY' });
    }

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) {
        continue;
      }

      if (current.depth > maxDepth) {
        continue;
      }

      if (seen.has(current.entityId) && current.depth > 0) {
        continue;
      }
      seen.add(current.entityId);

      const outgoing = snapshot.outgoingRelationships.get(current.entityId) ?? [];
      const incoming = snapshot.incomingRelationships.get(current.entityId) ?? [];
      const nextEdges = [...outgoing, ...incoming];

      for (const relationship of nextEdges) {
        const nextEntityId = relationship.source_entity_id === current.entityId
          ? relationship.target_entity_id
          : relationship.source_entity_id;

        const direction = relationship.target_entity_id === current.entityId ? 'incoming' : 'outgoing';

        if (relationship.relation !== 'CALLS' && relationship.relation !== 'REFERENCES' && relationship.relation !== 'IMPORTS' && relationship.relation !== 'INHERITS' && relationship.relation !== 'IMPLEMENTS') {
          continue;
        }

        if (relationship.resolution === 'POSSIBLE' || relationship.resolution === 'UNKNOWN') {
          unresolvedRelationships.push(`${relationship.source_entity_id}->${relationship.target_entity_id}:${relationship.relation}:${relationship.resolution}`);
        }

        traversedRelationships.push(`${relationship.source_entity_id}->${relationship.target_entity_id}:${relationship.relation}`);

        const targetEntity = entityMap.get(nextEntityId);
        if (!targetEntity || nextEntityId === current.entityId) {
          continue;
        }

        if (!affectedEntities.has(nextEntityId) && !changedEntities.includes(nextEntityId)) {
          affectedEntities.add(nextEntityId);
          if (targetEntity.file_path) {
            affectedFiles.add(targetEntity.file_path);
          }
        }

        const reason: ImpactReason = {
          entityId: nextEntityId,
          entityQualifiedName: targetEntity.qualified_name ?? targetEntity.name,
          reason: toImpactReasonKind(relationship, direction),
          distance: current.depth + 1,
          relationship: relationship.relation,
          resolution: relationship.resolution,
        };

        reasons.push(reason);

        if (current.depth + 1 <= maxDepth && affectedEntities.size + changedEntities.length <= maxEntities) {
          queue.push({ entityId: nextEntityId, depth: current.depth + 1, reason: reason.reason, relationship });
        }
      }
    }

    const truncated = affectedEntities.size > maxEntities || affectedFiles.size > maxFiles || reasons.some((reason) => reason.distance > maxDepth);
    const complete = !truncated && unresolvedRelationships.length === 0;
    const requiresScopeExpansion = unresolvedRelationships.length > 0 || affectedEntities.size >= maxEntities || affectedFiles.size >= maxFiles || truncated;

    const scope: AnalysisScopeDefinition = {
      mode: 'IMPACTED',
      entityIds: Array.from(affectedEntities),
      fileIds: Array.from(affectedFiles),
      reason: requiresScopeExpansion ? 'CHANGE_IMPACT' : 'IMPACTED_ANALYSIS',
      complete,
    };

    return {
      repositoryId,
      commitId,
      changedEntities,
      affectedEntities: Array.from(affectedEntities),
      affectedFiles: Array.from(affectedFiles),
      traversedRelationships,
      unresolvedRelationships,
      maxDepth,
      maxEntities,
      maxFiles,
      truncated,
      complete,
      requiresScopeExpansion,
      reasons,
      scope,
    };
  }
}

export const impactAnalysisEngine = new ImpactAnalysisEngine();
