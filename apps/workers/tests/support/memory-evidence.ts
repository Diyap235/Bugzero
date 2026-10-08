import type {
  CreateEvidenceInput,
  EvidenceEdgeRecord,
  EvidenceGraphInput,
  EvidenceGraphRecord,
  EvidenceNodeRecord,
  EvidencePathRecord,
  EvidenceRecord,
} from '@bugzero/database';

export class MemoryEvidenceRepository {
  readonly graphs = new Map<string, EvidenceGraphRecord>();

  async createGraph(input: EvidenceGraphInput): Promise<{ graph: EvidenceGraphRecord; created: boolean }> {
    const identity = `${input.snapshot.organizationId}|${input.snapshot.findingOccurrenceId}|${input.snapshot.identityFingerprint}`;
    const existing = this.graphs.get(identity);
    if (existing) return { graph: existing, created: false };

    const snapshotInput: CreateEvidenceInput = input.snapshot;
    const snapshot: EvidenceRecord = {
      id: `evidence-${this.graphs.size + 1}`,
      organization_id: snapshotInput.organizationId,
      finding_id: snapshotInput.findingId,
      finding_occurrence_id: snapshotInput.findingOccurrenceId,
      analysis_run_id: snapshotInput.analysisRunId,
      repository_id: snapshotInput.repositoryId,
      commit_id: snapshotInput.commitId,
      identity_fingerprint: snapshotInput.identityFingerprint,
      authority: snapshotInput.authority,
      origin: snapshotInput.origin,
      sufficiency: snapshotInput.sufficiency,
      completeness: snapshotInput.completeness,
      complete: snapshotInput.completeness === 'COMPLETE',
      diagnostics: snapshotInput.diagnostics ?? [],
      analyzer_versions: snapshotInput.analyzerVersions ?? {},
      paths: snapshotInput.paths ?? [],
      created_at: new Date(0).toISOString(),
    };
    const nodes: EvidenceNodeRecord[] = input.nodes.map((node) => ({
      organization_id: node.organizationId,
      evidence_id: snapshot.id,
      node_key: node.nodeKey,
      node_type: node.nodeType,
      label: node.label,
      file_path: node.filePath ?? null,
      line: node.line ?? null,
      end_line: node.endLine ?? null,
      start_column: node.startColumn ?? null,
      end_column: node.endColumn ?? null,
      attributes: node.attributes ?? {},
    }));
    const edges: EvidenceEdgeRecord[] = input.edges.map((edge) => ({
      organization_id: edge.organizationId,
      evidence_id: snapshot.id,
      edge_key: edge.edgeKey,
      from_node_key: edge.fromNodeKey,
      to_node_key: edge.toNodeKey,
      relation: edge.relation,
      resolution: edge.resolution,
      confidence: edge.confidence,
      attributes: edge.attributes ?? {},
    }));
    const graph = { snapshot, nodes, edges };
    this.graphs.set(identity, graph);
    return { graph, created: true };
  }

  evidencePaths(): EvidencePathRecord[] {
    return [...this.graphs.values()].flatMap((graph) => graph.snapshot.paths);
  }
}
