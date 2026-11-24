import type { CodeRelationshipRecord } from '@bugzero/database';

import type { FindingCandidate } from '../analyzers/types.js';
import { codeGraphRelationshipId, type CodeGraphScope } from './code-graph.repository.js';

export interface SourceToSinkGraphResult {
  relationships: CodeRelationshipRecord[];
  diagnostics: string[];
}

export function buildSourceToSinkRelationships(
  scope: CodeGraphScope,
  candidates: readonly FindingCandidate[],
  entityIds: ReadonlySet<string>,
): SourceToSinkGraphResult {
  const relationships: CodeRelationshipRecord[] = [];
  const diagnostics: string[] = [];
  const createdAt = new Date().toISOString();

  for (const candidate of candidates) {
    const graph = candidate.evidenceGraph;
    if (candidate.category !== 'SECURITY' || !graph
      || graph.completeness !== 'COMPLETE' || graph.sufficiency !== 'SUFFICIENT') continue;

    const nodesByKey = new Map(graph.nodes.map((node) => [node.nodeKey, node]));
    const edgesByKey = new Map(graph.edges.map((edge) => [edge.edgeKey, edge]));
    for (const path of graph.paths) {
      if (path.completeness !== 'COMPLETE') {
        diagnostics.push(`${candidate.ruleId}: incomplete source-to-sink evidence path was not materialized`);
        continue;
      }
      if (path.nodeIds.length < 2) {
        diagnostics.push(`${candidate.ruleId}: source-to-sink evidence path has too few nodes`);
        continue;
      }
      const pathNodes = path.nodeIds.map((nodeId) => nodesByKey.get(nodeId));
      const pathEdges = path.edgeIds.map((edgeId) => edgesByKey.get(edgeId));
      if (
        pathNodes.some((node) => node === undefined)
        || pathEdges.length !== pathNodes.length - 1
        || pathEdges.some((edge, index) => (
          edge === undefined
          || edge.fromNodeKey !== path.nodeIds[index]
          || edge.toNodeKey !== path.nodeIds[index + 1]
          || edge.resolution !== 'EXACT'
          || edge.confidence !== 'HIGH'
        ))
      ) {
        diagnostics.push(`${candidate.ruleId}: source-to-sink evidence path has missing or non-authoritative edges`);
        continue;
      }
      const source = pathNodes.find((node) => node?.nodeType === 'SOURCE');
      const sink = [...pathNodes].reverse().find((node) => node?.nodeType === 'SINK');
      const sourceEntityId = source?.attributes.sourceEntityId;
      const sinkEntityId = sink?.attributes.sourceEntityId;
      if (typeof sourceEntityId !== 'string' || typeof sinkEntityId !== 'string') {
        diagnostics.push(`${candidate.ruleId}: complete source-to-sink evidence is not linked to code entities`);
        continue;
      }
      if (!entityIds.has(sourceEntityId) || !entityIds.has(sinkEntityId)) {
        diagnostics.push(`${candidate.ruleId}: source-to-sink evidence refers to a code entity outside the persisted graph`);
        continue;
      }

      relationships.push({
        id: codeGraphRelationshipId(
          scope,
          sourceEntityId,
          `DATA_FLOWS_TO:${candidate.ruleId}:${path.id}`,
          sinkEntityId,
        ),
        organization_id: scope.organizationId,
        repository_id: scope.repositoryId,
        commit_id: scope.commitId,
        analysis_run_id: scope.analysisRunId,
        source_entity_id: sourceEntityId,
        target_entity_id: sinkEntityId,
        relation: 'DATA_FLOWS_TO',
        resolution: 'EXACT',
        confidence: 'HIGH',
        provenance: {
          ruleId: candidate.ruleId,
          evidencePathId: path.id,
          evidenceNodeKeys: path.nodeIds,
          evidenceEdgeKeys: path.edgeIds,
        },
        created_at: createdAt,
      });
    }
  }

  return { relationships, diagnostics };
}
