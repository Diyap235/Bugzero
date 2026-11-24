import type { EvidenceCompleteness, EvidenceResolution } from '@bugzero/database';

export interface EvidenceTraversalNode {
  id: string;
}

export interface EvidenceTraversalEdge {
  id: string;
  from: string;
  to: string;
  relation: string;
  resolution: EvidenceResolution;
}

export interface EvidenceTraversalLimits {
  maxDepth: number;
  maxNodes: number;
  maxEdges: number;
  maxPaths: number;
  maxDurationMs: number;
}

export interface EvidenceTraversalPath {
  id: string;
  nodeIds: string[];
  edgeIds: string[];
  completeness: EvidenceCompleteness;
  diagnostics: string[];
}

export interface EvidenceTraversalResult {
  paths: EvidenceTraversalPath[];
  completeness: EvidenceCompleteness;
  diagnostics: string[];
  metrics: {
    nodesVisited: number;
    edgesVisited: number;
    durationMs: number;
    budgetExhausted: boolean;
  };
}

export const defaultEvidenceTraversalLimits: EvidenceTraversalLimits = {
  maxDepth: 10,
  maxNodes: 500,
  maxEdges: 1_000,
  maxPaths: 100,
  maxDurationMs: 1_000,
};

export class EvidencePathBuilder {
  buildPaths(
    startNodeId: string,
    targetNodeId: string,
    nodes: EvidenceTraversalNode[],
    edges: EvidenceTraversalEdge[],
    overrides: Partial<EvidenceTraversalLimits> = {},
  ): EvidenceTraversalResult {
    const startedAt = Date.now();
    const limits = { ...defaultEvidenceTraversalLimits, ...overrides };
    for (const [name, value] of Object.entries(limits)) {
      if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Invalid evidence traversal budget ${name}`);
    }

    const nodeIds = new Set(nodes.map((node) => node.id));
    if (!nodeIds.has(startNodeId) || !nodeIds.has(targetNodeId)) {
      return {
        paths: [],
        completeness: 'INCOMPLETE',
        diagnostics: ['Evidence path endpoint is absent from this graph snapshot'],
        metrics: { nodesVisited: 0, edgesVisited: 0, durationMs: Date.now() - startedAt, budgetExhausted: false },
      };
    }

    const adjacency = new Map<string, EvidenceTraversalEdge[]>();
    const unresolvedEndpoints = new Set<string>();
    for (const edge of edges) {
      if (edge.resolution !== 'EXACT') {
        unresolvedEndpoints.add(edge.from);
        continue;
      }
      adjacency.set(edge.from, [...(adjacency.get(edge.from) ?? []), edge]);
    }
    for (const outgoing of adjacency.values()) outgoing.sort((a, b) => a.id.localeCompare(b.id));

    const paths: EvidenceTraversalPath[] = [];
    const diagnostics: string[] = [];
    const queue: Array<{ nodeIds: string[]; edgeIds: string[] }> = [{ nodeIds: [startNodeId], edgeIds: [] }];
    let nodesVisited = 0;
    let edgesVisited = 0;
    let budgetExhausted = false;
    let unresolvedEncountered = false;

    while (queue.length > 0) {
      if (Date.now() - startedAt >= limits.maxDurationMs) {
        diagnostics.push(`Exceeded maxDurationMs budget (${limits.maxDurationMs})`);
        budgetExhausted = true;
        break;
      }
      if (paths.length >= limits.maxPaths) {
        diagnostics.push(`Exceeded maxPaths budget (${limits.maxPaths})`);
        budgetExhausted = true;
        break;
      }
      const current = queue.shift();
      if (!current) break;
      const currentNodeId = current.nodeIds[current.nodeIds.length - 1];
      nodesVisited += 1;
      if (currentNodeId === targetNodeId) {
        paths.push({
          id: `${startNodeId}:${targetNodeId}:${paths.length}`,
          nodeIds: current.nodeIds,
          edgeIds: current.edgeIds,
          completeness: 'COMPLETE',
          diagnostics: [],
        });
        continue;
      }
      if (current.edgeIds.length >= limits.maxDepth) {
        if ((adjacency.get(currentNodeId)?.length ?? 0) > 0) {
          diagnostics.push(`Exceeded maxDepth budget (${limits.maxDepth})`);
          budgetExhausted = true;
        }
        continue;
      }

      if (unresolvedEndpoints.has(currentNodeId)) unresolvedEncountered = true;
      for (const edge of adjacency.get(currentNodeId) ?? []) {
        if (current.nodeIds.includes(edge.to)) continue;
        if (edgesVisited >= limits.maxEdges || nodesVisited + queue.length >= limits.maxNodes) {
          diagnostics.push(edgesVisited >= limits.maxEdges
            ? `Exceeded maxEdges budget (${limits.maxEdges})`
            : `Exceeded maxNodes budget (${limits.maxNodes})`);
          budgetExhausted = true;
          break;
        }
        edgesVisited += 1;
        queue.push({ nodeIds: [...current.nodeIds, edge.to], edgeIds: [...current.edgeIds, edge.id] });
      }
      if (budgetExhausted) break;
    }

    if (unresolvedEncountered) diagnostics.push('Unresolved relationships were not traversed as exact evidence');
    const completeness: EvidenceCompleteness = budgetExhausted
      ? 'PARTIAL'
      : unresolvedEncountered ? 'PARTIAL' : 'COMPLETE';
    if (paths.length === 0 && completeness === 'COMPLETE') {
      return {
        paths,
        completeness: 'INCOMPLETE',
        diagnostics: ['No exact path connects the requested evidence endpoints'],
        metrics: { nodesVisited, edgesVisited, durationMs: Date.now() - startedAt, budgetExhausted },
      };
    }
    return {
      paths: paths.map((path) => completeness === 'COMPLETE'
        ? path
        : { ...path, completeness, diagnostics: [...diagnostics] }),
      completeness,
      diagnostics,
      metrics: { nodesVisited, edgesVisited, durationMs: Date.now() - startedAt, budgetExhausted },
    };
  }
}
