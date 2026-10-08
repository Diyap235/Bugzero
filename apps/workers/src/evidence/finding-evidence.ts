import { createHash } from 'node:crypto';
import type {
  CodeEntityRecord,
  CodeRelationshipRecord,
  EvidenceCompleteness,
  EvidenceEdgeRecord,
  EvidenceNodeRecord,
  EvidencePathRecord,
  EvidenceRepository,
} from '@bugzero/database';

import type { FindingCandidate } from '../analyzers/types.js';
import type { RepositoryIntelligenceSnapshot } from '../intelligence/types.js';
import {
  EvidencePathBuilder,
  defaultEvidenceTraversalLimits,
  type EvidenceTraversalLimits,
} from './evidence-path-builder.js';

type GraphNodeInput = Parameters<EvidenceRepository['createGraph']>[0]['nodes'][number];
type GraphEdgeInput = Parameters<EvidenceRepository['createGraph']>[0]['edges'][number];

export interface BuiltFindingEvidenceGraph {
  identityFingerprint: string;
  completeness: EvidenceCompleteness;
  sufficiency: 'SUFFICIENT' | 'INSUFFICIENT' | 'UNKNOWN';
  diagnostics: string[];
  nodes: GraphNodeInput[];
  edges: GraphEdgeInput[];
  paths: EvidencePathRecord[];
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function hash(value: unknown): string {
  return createHash('sha256').update(stableSerialize(value)).digest('hex');
}

function nodeType(entity: CodeEntityRecord): GraphNodeInput['nodeType'] {
  switch (entity.entity_type) {
    case 'REPOSITORY': return 'REPOSITORY';
    case 'FILE': return 'FILE';
    case 'MODULE': return 'MODULE';
    case 'CLASS': return 'CLASS';
    case 'FUNCTION': return 'FUNCTION';
    case 'METHOD': return 'METHOD';
    case 'PARAMETER': return 'PARAMETER';
    case 'SYMBOL': return 'VARIABLE';
    case 'TYPE': return 'UNKNOWN';
    case 'CONSTANT': return 'VARIABLE';
  }
}

function entityKey(entity: CodeEntityRecord): string {
  return `entity:${entity.id}`;
}

function nodeForEntity(entity: CodeEntityRecord, findingId: string, organizationId: string): GraphNodeInput {
  return {
    organizationId,
    nodeKey: entityKey(entity),
    nodeType: nodeType(entity),
    label: entity.qualified_name ?? entity.name,
    filePath: entity.file_path,
    line: entity.start_line,
    endLine: entity.end_line,
    attributes: {
      sourceEntityId: entity.id,
      findingId,
      provenance: 'CODE_IR',
      authority: 'AUTHORITATIVE',
      confidence: 'HIGH',
      entityType: entity.entity_type,
      qualifiedName: entity.qualified_name,
      sourceLocation: {
        filePath: entity.file_path,
        startLine: entity.start_line,
        endLine: entity.end_line,
      },
      sourceProvenance: entity.provenance,
    },
  };
}

function relationKey(relationship: CodeRelationshipRecord): string {
  return `relationship:${relationship.id}`;
}

function edgeForRelationship(relationship: CodeRelationshipRecord, organizationId: string): GraphEdgeInput {
  return {
    organizationId,
    edgeKey: relationKey(relationship),
    fromNodeKey: `entity:${relationship.source_entity_id}`,
    toNodeKey: `entity:${relationship.target_entity_id}`,
    relation: relationship.relation,
    resolution: relationship.resolution,
    confidence: relationship.confidence ?? 'LOW',
    attributes: {
      sourceRelationshipId: relationship.id,
      provenance: 'REPOSITORY_INTELLIGENCE',
      sourceProvenance: relationship.provenance,
    },
  };
}

function pathForEdge(from: string, edge: GraphEdgeInput, maxDurationMs: number): EvidencePathRecord | null {
  const result = new EvidencePathBuilder().buildPaths(
    from,
    edge.toNodeKey,
    [{ id: from }, { id: edge.toNodeKey }],
    [{
      id: edge.edgeKey,
      from,
      to: edge.toNodeKey,
      relation: edge.relation,
      resolution: edge.resolution,
    }],
    { ...defaultEvidenceTraversalLimits, maxDepth: 1, maxPaths: 1, maxDurationMs },
  );
  const path = result.paths[0];
  return path ? {
    id: path.id,
    nodeIds: path.nodeIds,
    edgeIds: path.edgeIds,
    completeness: path.completeness,
    diagnostics: path.diagnostics,
  } : null;
}

export function buildFindingEvidenceGraph(
  findingId: string,
  candidate: FindingCandidate,
  intelligence: RepositoryIntelligenceSnapshot,
  overrides: Partial<EvidenceTraversalLimits> = {},
): BuiltFindingEvidenceGraph {
  if (candidate.category === 'SECURITY' && candidate.evidenceGraph) {
    const graph = candidate.evidenceGraph;
    return {
      identityFingerprint: hash({
        ruleId: candidate.ruleId,
        ruleVersion: candidate.ruleVersion,
        semanticTarget: candidate.semanticTarget,
        fingerprintInputs: candidate.fingerprintInputs,
        edgeKeys: graph.edges.map((edge) => edge.edgeKey).sort(),
      }),
      completeness: graph.completeness,
      sufficiency: graph.sufficiency,
      diagnostics: [...graph.diagnostics],
      nodes: graph.nodes.map((node) => ({
        organizationId: intelligence.organizationId,
        nodeKey: node.nodeKey,
        nodeType: node.nodeType,
        label: node.label,
        filePath: node.filePath,
        line: node.line,
        endLine: node.endLine,
        attributes: { ...node.attributes, findingId, provenance: 'SECURITY_ANALYZER' },
      })),
      edges: graph.edges.map((edge) => ({
        organizationId: intelligence.organizationId,
        edgeKey: edge.edgeKey,
        fromNodeKey: edge.fromNodeKey,
        toNodeKey: edge.toNodeKey,
        relation: edge.relation,
        resolution: edge.resolution,
        confidence: edge.confidence,
        attributes: { ...edge.attributes, provenance: 'SECURITY_ANALYZER' },
      })),
      paths: graph.paths,
    };
  }
  const startedAt = Date.now();
  const limits = { ...defaultEvidenceTraversalLimits, ...overrides };
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Invalid evidence traversal budget ${name}`);
  }
  const ruleId = candidate.ruleId;
  const target = intelligence.entities.find((entity) =>
    entity.file_path === candidate.file
    && (entity.qualified_name ?? entity.name) === candidate.semanticTarget
    && (
      entity.entity_type === 'FUNCTION'
      || entity.entity_type === 'METHOD'
      || ((ruleId === 'HIGH_FAN_OUT' || ruleId === 'HIGH_FAN_IN') && entity.entity_type === 'CLASS')
    ),
  );
  const nodes: GraphNodeInput[] = [];
  const edges: GraphEdgeInput[] = [];
  const paths: EvidencePathRecord[] = [];
  const diagnostics: string[] = [];
  const durationBudgetDiagnostic = `Exceeded maxDurationMs budget (${limits.maxDurationMs})`;
  const durationExceeded = () => {
    if (Date.now() - startedAt < limits.maxDurationMs) return false;
    if (!diagnostics.includes(durationBudgetDiagnostic)) diagnostics.push(durationBudgetDiagnostic);
    return true;
  };
  if (!target) {
    diagnostics.push('Finding target could not be mapped to a persisted Code IR entity');
    return {
      identityFingerprint: hash({ ruleId, findingId, target: candidate.semanticTarget, evidence: candidate.evidenceInputs }),
      completeness: 'INCOMPLETE',
      sufficiency: 'UNKNOWN',
      diagnostics,
      nodes,
      edges,
      paths,
    };
  }

  const targetKey = entityKey(target);
  nodes.push(nodeForEntity(target, findingId, intelligence.organizationId));
  const relatedEdges: CodeRelationshipRecord[] = [];

  if (ruleId === 'HIGH_PARAMETER_COUNT') {
    for (const relationship of intelligence.relationships) {
      if (durationExceeded()) break;
      if (relationship.source_entity_id === target.id
        && relationship.relation === 'DECLARES'
        && relationship.resolution === 'EXACT'
        && intelligence.entityIndex.get(relationship.target_entity_id)?.entity_type === 'PARAMETER') {
        relatedEdges.push(relationship);
      }
    }
  } else if (ruleId === 'HIGH_FAN_OUT') {
    for (const relationship of intelligence.relationships) {
      if (durationExceeded()) break;
      if (relationship.source_entity_id === target.id
        && relationship.relation === 'CALLS'
        && relationship.resolution === 'EXACT') relatedEdges.push(relationship);
    }
  } else if (ruleId === 'HIGH_FAN_IN') {
    for (const relationship of intelligence.relationships) {
      if (durationExceeded()) break;
      if (relationship.target_entity_id === target.id
        && relationship.relation === 'CALLS'
        && relationship.resolution === 'EXACT') relatedEdges.push(relationship);
    }
  }

  for (const relationship of relatedEdges) {
    if (durationExceeded()) break;
    const fromEntity = intelligence.entityIndex.get(relationship.source_entity_id);
    const toEntity = intelligence.entityIndex.get(relationship.target_entity_id);
    if (!fromEntity || !toEntity) {
      diagnostics.push(`Exact ${relationship.relation} relationship ${relationship.id} has a missing entity endpoint`);
      continue;
    }
    const fromKey = entityKey(fromEntity);
    const toKey = entityKey(toEntity);
    if (!nodes.some((node) => node.nodeKey === fromKey)) nodes.push(nodeForEntity(fromEntity, findingId, intelligence.organizationId));
    if (!nodes.some((node) => node.nodeKey === toKey)) nodes.push(nodeForEntity(toEntity, findingId, intelligence.organizationId));
    const edge = edgeForRelationship(relationship, intelligence.organizationId);
    edges.push(edge);
    const path = pathForEdge(fromKey, edge, Math.max(0, limits.maxDurationMs - (Date.now() - startedAt)));
    if (path) paths.push(path);
    else diagnostics.push(`No bounded exact evidence path could be built for relationship ${relationship.id}`);
    if (durationExceeded()) break;
  }

  if (ruleId === 'LONG_FUNCTION') {
    const details = candidate.evidenceInputs;
    nodes[0].attributes = {
      ...nodes[0].attributes,
      fact: 'SOURCE_SPAN_EXCEEDS_THRESHOLD',
      measuredLineCount: details.measuredLineCount,
      configuredThreshold: details.configuredThreshold,
      provenance: 'STATIC_ANALYZER',
    };
    if (!durationExceeded()) {
      paths.push({
        id: `path:span:${hash([target.id, details.measuredLineCount, details.configuredThreshold]).slice(0, 16)}`,
        nodeIds: [targetKey],
        edgeIds: [],
        completeness: 'COMPLETE',
        diagnostics: [],
      });
    }
  } else if (ruleId === 'HIGH_PARAMETER_COUNT') {
    nodes[0].attributes = {
      ...nodes[0].attributes,
      fact: 'DECLARED_PARAMETER_COUNT_EXCEEDS_THRESHOLD',
      parameterCount: relatedEdges.length,
      configuredThreshold: candidate.evidenceInputs.configuredThreshold,
      provenance: 'STATIC_ANALYZER',
    };
  } else if (ruleId === 'HIGH_FAN_OUT' || ruleId === 'HIGH_FAN_IN') {
    nodes[0].attributes = {
      ...nodes[0].attributes,
      fact: ruleId === 'HIGH_FAN_OUT' ? 'EXACT_OUTGOING_CALL_COUNT' : 'EXACT_INCOMING_CALL_COUNT',
      relationshipCount: relatedEdges.length,
      configuredThreshold: candidate.evidenceInputs.configuredThreshold,
      provenance: 'STATIC_ANALYZER',
    };
  } else if (ruleId === 'EMPTY_FUNCTION') {
    const sourceKey = `source:${target.id}:${target.start_line ?? 0}`;
    nodes.push({
      organizationId: intelligence.organizationId,
      nodeKey: sourceKey,
      nodeType: 'SOURCE',
      label: 'Explicit empty function body',
      filePath: target.file_path,
      line: target.start_line,
      endLine: target.end_line,
      attributes: {
        findingId,
        classification: 'EMPTY_BODY',
        sourceBacked: true,
        provenance: 'STATIC_ANALYZER',
        sourceLocation: {
          filePath: target.file_path,
          startLine: target.start_line,
          endLine: target.end_line,
        },
      },
    });
    const edge: GraphEdgeInput = {
      organizationId: intelligence.organizationId,
      edgeKey: `classification:${hash([target.id, ruleId, target.start_line, target.end_line]).slice(0, 20)}`,
      fromNodeKey: targetKey,
      toNodeKey: sourceKey,
      relation: 'CONTAINS',
      resolution: 'EXACT',
      confidence: 'HIGH',
      attributes: { provenance: 'STATIC_ANALYZER', classification: 'EMPTY_BODY' },
    };
    edges.push(edge);
    const path = pathForEdge(targetKey, edge, Math.max(0, limits.maxDurationMs - (Date.now() - startedAt)));
    if (path) paths.push(path);
    else diagnostics.push('No bounded exact evidence path could be built for the empty-body classification');
  }

  const unresolvedCallEvidence = ruleId === 'HIGH_FAN_OUT'
    ? intelligence.relationships.some((relationship) =>
      relationship.source_entity_id === target.id && relationship.relation === 'CALLS' && relationship.resolution !== 'EXACT',
    )
    : ruleId === 'HIGH_FAN_IN'
      ? intelligence.relationships.some((relationship) =>
        relationship.target_entity_id === target.id && relationship.relation === 'CALLS' && relationship.resolution !== 'EXACT',
      )
      : false;
  if (unresolvedCallEvidence) diagnostics.push('Unresolved call relationships exist at the measured target and were not represented as exact evidence');

  const budgetDiagnostics: string[] = [];
  if (nodes.length > limits.maxNodes) {
    budgetDiagnostics.push(`Exceeded maxNodes budget (${limits.maxNodes})`);
  }
  if (edges.length > limits.maxEdges) {
    budgetDiagnostics.push(`Exceeded maxEdges budget (${limits.maxEdges})`);
  }
  if (paths.length > limits.maxPaths) {
    budgetDiagnostics.push(`Exceeded maxPaths budget (${limits.maxPaths})`);
  }
  diagnostics.push(...budgetDiagnostics);
  if (budgetDiagnostics.length > 0) {
    nodes.splice(limits.maxNodes);
    const retainedNodeKeys = new Set(nodes.map((node) => node.nodeKey));
    edges.splice(limits.maxEdges);
    for (let index = edges.length - 1; index >= 0; index -= 1) {
      if (!retainedNodeKeys.has(edges[index].fromNodeKey) || !retainedNodeKeys.has(edges[index].toNodeKey)) edges.splice(index, 1);
    }
    paths.splice(limits.maxPaths);
  }
  const completeness: EvidenceCompleteness = diagnostics.length > 0 ? 'PARTIAL' : 'COMPLETE';
  return {
    identityFingerprint: hash({
      ruleId,
      ruleVersion: candidate.ruleVersion,
      target: target.id,
      evidence: candidate.evidenceInputs,
      edgeKeys: edges.map((edge) => edge.edgeKey).sort(),
    }),
    completeness,
    sufficiency: completeness === 'COMPLETE' ? 'SUFFICIENT' : 'UNKNOWN',
    diagnostics,
    nodes,
    edges,
    paths,
  };
}

export function toEvidenceResponseNode(node: EvidenceNodeRecord) {
  const metadata = node.attributes;
  return {
    organizationId: node.organization_id,
    evidenceId: node.evidence_id,
    id: node.node_key,
    type: node.node_type,
    label: node.label,
    filePath: node.file_path,
    line: node.line,
    endLine: node.end_line,
    startColumn: node.start_column,
    endColumn: node.end_column,
    sourceEntityId: typeof metadata.sourceEntityId === 'string' ? metadata.sourceEntityId : null,
    findingId: typeof metadata.findingId === 'string' ? metadata.findingId : null,
    authority: metadata.authority === 'INVESTIGATIVE' ? 'INVESTIGATIVE' as const : 'AUTHORITATIVE' as const,
    confidence: metadata.confidence === 'LOW' || metadata.confidence === 'MEDIUM' ? metadata.confidence : 'HIGH' as const,
    provenance: metadata.provenance === 'REPOSITORY_INTELLIGENCE' ? 'REPOSITORY_INTELLIGENCE' as const
      : metadata.provenance === 'AI' ? 'AI' as const
        : metadata.provenance === 'HUMAN' ? 'HUMAN' as const
          : metadata.provenance === 'CODE_IR' ? 'CODE_IR' as const : 'STATIC_ANALYZER' as const,
    metadata,
  };
}

export function toEvidenceResponseEdge(edge: EvidenceEdgeRecord) {
  return {
    organizationId: edge.organization_id,
    evidenceId: edge.evidence_id,
    id: edge.edge_key,
    from: edge.from_node_key,
    to: edge.to_node_key,
    relation: edge.relation,
    resolution: edge.resolution,
    confidence: edge.confidence,
  };
}
