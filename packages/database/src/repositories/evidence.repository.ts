import type { Pool, PoolClient } from 'pg';

import { getDatabasePool } from '../client/postgres.js';
import { setTransactionOrganizationContext } from '../client/tenant-context.js';

export type EvidenceAuthority = 'AUTHORITATIVE' | 'INVESTIGATIVE';
export type EvidenceOrigin = 'DETERMINISTIC_ANALYZER' | 'HEURISTIC' | 'AI' | 'HUMAN_VALIDATION';
export type EvidenceSufficiency = 'SUFFICIENT' | 'INSUFFICIENT' | 'UNKNOWN';
export type EvidenceCompleteness = 'COMPLETE' | 'PARTIAL' | 'INCOMPLETE';
export type EvidenceResolution = 'EXACT' | 'INFERRED' | 'POSSIBLE' | 'UNKNOWN';
export type EvidenceConfidence = 'LOW' | 'MEDIUM' | 'HIGH';
export type EvidenceNodeType =
  | 'REPOSITORY' | 'FILE' | 'MODULE' | 'CLASS' | 'FUNCTION' | 'METHOD'
  | 'PARAMETER' | 'VARIABLE' | 'DEPENDENCY' | 'EXTERNAL_BOUNDARY' | 'CALL'
  | 'TRANSFORMATION' | 'SANITIZER' | 'SINK' | 'SOURCE'
  | 'DATABASE_OPERATION' | 'FILE_OPERATION' | 'PROCESS_OPERATION' | 'UNKNOWN';

export interface EvidenceRecord {
  id: string;
  organization_id: string;
  finding_id: string;
  finding_occurrence_id: string;
  analysis_run_id: string;
  repository_id: string;
  commit_id: string;
  identity_fingerprint: string;
  authority: EvidenceAuthority;
  origin: EvidenceOrigin;
  sufficiency: EvidenceSufficiency;
  completeness: EvidenceCompleteness;
  complete: boolean;
  diagnostics: string[];
  analyzer_versions: Record<string, unknown>;
  paths: EvidencePathRecord[];
  created_at: string;
}

export interface EvidenceNodeRecord {
  organization_id: string;
  evidence_id: string;
  node_key: string;
  node_type: EvidenceNodeType;
  label: string;
  file_path: string | null;
  line: number | null;
  end_line: number | null;
  start_column: number | null;
  end_column: number | null;
  attributes: Record<string, unknown>;
}

export interface EvidenceEdgeRecord {
  organization_id: string;
  evidence_id: string;
  edge_key: string;
  from_node_key: string;
  to_node_key: string;
  relation: string;
  resolution: EvidenceResolution;
  confidence: EvidenceConfidence;
  attributes: Record<string, unknown>;
}

export interface EvidencePathRecord {
  id: string;
  nodeIds: string[];
  edgeIds: string[];
  completeness: EvidenceCompleteness;
  diagnostics: string[];
}

export interface CreateEvidenceInput {
  organizationId: string;
  findingId: string;
  findingOccurrenceId: string;
  analysisRunId: string;
  repositoryId: string;
  commitId: string;
  identityFingerprint: string;
  authority: EvidenceAuthority;
  origin: EvidenceOrigin;
  sufficiency: EvidenceSufficiency;
  completeness: EvidenceCompleteness;
  analyzerVersions?: Record<string, unknown>;
  paths?: EvidencePathRecord[];
  diagnostics?: string[];
}

export interface CreateEvidenceNodeInput {
  organizationId: string;
  evidenceId: string;
  nodeKey: string;
  nodeType: EvidenceNodeType;
  label: string;
  filePath?: string | null;
  line?: number | null;
  endLine?: number | null;
  startColumn?: number | null;
  endColumn?: number | null;
  attributes?: Record<string, unknown>;
}

export interface CreateEvidenceEdgeInput {
  organizationId: string;
  evidenceId: string;
  edgeKey: string;
  fromNodeKey: string;
  toNodeKey: string;
  relation: string;
  resolution: EvidenceResolution;
  confidence: EvidenceConfidence;
  attributes?: Record<string, unknown>;
}

export interface EvidenceGraphInput {
  snapshot: CreateEvidenceInput;
  nodes: Array<Omit<CreateEvidenceNodeInput, 'evidenceId'>>;
  edges: Array<Omit<CreateEvidenceEdgeInput, 'evidenceId'>>;
}

export interface EvidenceGraphRecord {
  snapshot: EvidenceRecord;
  nodes: EvidenceNodeRecord[];
  edges: EvidenceEdgeRecord[];
}

export class EvidenceRepository {
  constructor(private readonly pool: Pool = getDatabasePool()) {}

  async createSnapshot(input: CreateEvidenceInput): Promise<{ record: EvidenceRecord; created: boolean }> {
    const inserted = await this.pool.query<EvidenceRecord>(
      `INSERT INTO evidence (
        organization_id, finding_id, finding_occurrence_id, analysis_run_id,
        repository_id, commit_id, identity_fingerprint, authority, origin,
        sufficiency, completeness, complete, analyzer_versions, paths, diagnostics
      )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       ON CONFLICT (organization_id, finding_occurrence_id, identity_fingerprint) DO NOTHING
       RETURNING *`,
      this.snapshotValues(input),
    );
    if (inserted.rows[0]) return { record: inserted.rows[0], created: true };

    const existing = await this.pool.query<EvidenceRecord>(
      `SELECT * FROM evidence
       WHERE organization_id = $1 AND finding_occurrence_id = $2 AND identity_fingerprint = $3`,
      [input.organizationId, input.findingOccurrenceId, input.identityFingerprint],
    );
    if (!existing.rows[0]) throw new Error('Evidence snapshot conflict occurred but snapshot could not be loaded');
    return { record: existing.rows[0], created: false };
  }

  async createGraph(input: EvidenceGraphInput): Promise<{ graph: EvidenceGraphRecord; created: boolean }> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await setTransactionOrganizationContext(client);
      const inserted = await client.query<EvidenceRecord>(
        `INSERT INTO evidence (
          organization_id, finding_id, finding_occurrence_id, analysis_run_id,
          repository_id, commit_id, identity_fingerprint, authority, origin,
          sufficiency, completeness, complete, analyzer_versions, paths, diagnostics
        )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
         ON CONFLICT (organization_id, finding_occurrence_id, identity_fingerprint) DO NOTHING
         RETURNING *`,
        this.snapshotValues(input.snapshot),
      );
      let snapshot = inserted.rows[0];
      const created = snapshot !== undefined;
      if (!snapshot) {
        const existing = await client.query<EvidenceRecord>(
          `SELECT * FROM evidence
           WHERE organization_id = $1 AND finding_occurrence_id = $2 AND identity_fingerprint = $3
           FOR UPDATE`,
          [
            input.snapshot.organizationId,
            input.snapshot.findingOccurrenceId,
            input.snapshot.identityFingerprint,
          ],
        );
        snapshot = existing.rows[0];
        if (!snapshot) throw new Error('Evidence snapshot conflict occurred but snapshot could not be loaded');
      } else {
        for (const node of input.nodes) await this.insertNode(client, { ...node, evidenceId: snapshot.id });
        for (const edge of input.edges) await this.insertEdge(client, { ...edge, evidenceId: snapshot.id });
      }
      const nodes = await client.query<EvidenceNodeRecord>(
        'SELECT * FROM evidence_nodes WHERE organization_id = $1 AND evidence_id = $2 ORDER BY node_key',
        [snapshot.organization_id, snapshot.id],
      );
      const edges = await client.query<EvidenceEdgeRecord>(
        'SELECT * FROM evidence_edges WHERE organization_id = $1 AND evidence_id = $2 ORDER BY edge_key',
        [snapshot.organization_id, snapshot.id],
      );
      await client.query('COMMIT');
      return { graph: { snapshot, nodes: nodes.rows, edges: edges.rows }, created };
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        throw new AggregateError([error, rollbackError], 'Evidence graph write and rollback failed');
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async getSnapshot(organizationId: string, evidenceId: string): Promise<EvidenceGraphRecord | null> {
    const snapshot = await this.pool.query<EvidenceRecord>(
      'SELECT * FROM evidence WHERE organization_id = $1 AND id = $2',
      [organizationId, evidenceId],
    );
    if (!snapshot.rows[0]) return null;
    const [nodes, edges] = await Promise.all([
      this.pool.query<EvidenceNodeRecord>(
        'SELECT * FROM evidence_nodes WHERE organization_id = $1 AND evidence_id = $2 ORDER BY node_key',
        [organizationId, evidenceId],
      ),
      this.pool.query<EvidenceEdgeRecord>(
        'SELECT * FROM evidence_edges WHERE organization_id = $1 AND evidence_id = $2 ORDER BY edge_key',
        [organizationId, evidenceId],
      ),
    ]);
    return { snapshot: snapshot.rows[0], nodes: nodes.rows, edges: edges.rows };
  }

  async listForOccurrence(organizationId: string, findingOccurrenceId: string): Promise<EvidenceRecord[]> {
    const result = await this.pool.query<EvidenceRecord>(
      'SELECT * FROM evidence WHERE organization_id = $1 AND finding_occurrence_id = $2 ORDER BY created_at DESC, id',
      [organizationId, findingOccurrenceId],
    );
    return result.rows;
  }

  async getEvidenceForFinding(organizationId: string, findingId: string): Promise<EvidenceRecord[]> {
    const result = await this.pool.query<EvidenceRecord>(
      `SELECT * FROM evidence
       WHERE organization_id = $1 AND finding_id = $2
       ORDER BY commit_id, analysis_run_id, created_at, id`,
      [organizationId, findingId],
    );
    return result.rows;
  }

  async getNodesForFinding(organizationId: string, findingId: string): Promise<EvidenceNodeRecord[]> {
    const result = await this.pool.query<EvidenceNodeRecord>(
      `SELECT n.* FROM evidence_nodes n
       INNER JOIN evidence e
         ON e.organization_id = n.organization_id AND e.id = n.evidence_id
       WHERE e.organization_id = $1 AND e.finding_id = $2
       ORDER BY e.commit_id, e.analysis_run_id, n.node_key`,
      [organizationId, findingId],
    );
    return result.rows;
  }

  async getEdgesForFinding(organizationId: string, findingId: string): Promise<EvidenceEdgeRecord[]> {
    const result = await this.pool.query<EvidenceEdgeRecord>(
      `SELECT edge.* FROM evidence_edges edge
       INNER JOIN evidence e
         ON e.organization_id = edge.organization_id AND e.id = edge.evidence_id
       WHERE e.organization_id = $1 AND e.finding_id = $2
       ORDER BY e.commit_id, e.analysis_run_id, edge.edge_key`,
      [organizationId, findingId],
    );
    return result.rows;
  }

  async getPath(organizationId: string, evidenceId: string, pathId: string): Promise<EvidencePathRecord | null> {
    const result = await this.pool.query<{ paths: EvidencePathRecord[] }>(
      `SELECT paths FROM evidence
       WHERE organization_id = $1 AND id = $2`,
      [organizationId, evidenceId],
    );
    return result.rows[0]?.paths.find((path) => path.id === pathId) ?? null;
  }

  async createNode(input: CreateEvidenceNodeInput): Promise<EvidenceNodeRecord> {
    await this.insertNode(this.pool, input);
    const result = await this.pool.query<EvidenceNodeRecord>(
      `SELECT * FROM evidence_nodes
       WHERE organization_id = $1 AND evidence_id = $2 AND node_key = $3`,
      [input.organizationId, input.evidenceId, input.nodeKey],
    );
    if (!result.rows[0]) throw new Error('Evidence node was not persisted');
    return result.rows[0];
  }

  async createEdge(input: CreateEvidenceEdgeInput): Promise<EvidenceEdgeRecord> {
    await this.insertEdge(this.pool, input);
    const result = await this.pool.query<EvidenceEdgeRecord>(
      `SELECT * FROM evidence_edges
       WHERE organization_id = $1 AND evidence_id = $2 AND edge_key = $3`,
      [input.organizationId, input.evidenceId, input.edgeKey],
    );
    if (!result.rows[0]) throw new Error('Evidence edge was not persisted');
    return result.rows[0];
  }

  private snapshotValues(input: CreateEvidenceInput): unknown[] {
    return [
      input.organizationId,
      input.findingId,
      input.findingOccurrenceId,
      input.analysisRunId,
      input.repositoryId,
      input.commitId,
      input.identityFingerprint,
      input.authority,
      input.origin,
      input.sufficiency,
      input.completeness,
      input.completeness === 'COMPLETE',
      input.analyzerVersions ?? {},
      input.paths ?? [],
      input.diagnostics ?? [],
    ];
  }

  private async insertNode(client: Pick<PoolClient, 'query'> | Pool, input: CreateEvidenceNodeInput): Promise<void> {
    await client.query(
      `INSERT INTO evidence_nodes (
        organization_id, evidence_id, node_key, node_type, label, file_path,
        line, end_line, start_column, end_column, attributes
      )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (organization_id, evidence_id, node_key) DO NOTHING`,
      [
        input.organizationId, input.evidenceId, input.nodeKey, input.nodeType, input.label,
        input.filePath ?? null, input.line ?? null, input.endLine ?? null,
        input.startColumn ?? null, input.endColumn ?? null, input.attributes ?? {},
      ],
    );
  }

  private async insertEdge(client: Pick<PoolClient, 'query'> | Pool, input: CreateEvidenceEdgeInput): Promise<void> {
    await client.query(
      `INSERT INTO evidence_edges (
        organization_id, evidence_id, edge_key, from_node_key, to_node_key,
        relation, resolution, confidence, attributes
      )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (organization_id, evidence_id, edge_key) DO NOTHING`,
      [
        input.organizationId, input.evidenceId, input.edgeKey, input.fromNodeKey,
        input.toNodeKey, input.relation, input.resolution, input.confidence, input.attributes ?? {},
      ],
    );
  }
}

export const evidenceRepository = new EvidenceRepository();
