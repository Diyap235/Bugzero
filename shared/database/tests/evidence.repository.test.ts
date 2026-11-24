import test from 'node:test';
import assert from 'node:assert/strict';
import type { Pool } from 'pg';

import {
  EvidenceRepository,
  type CreateEvidenceInput,
  type EvidenceGraphInput,
  type EvidenceRecord,
  type EvidenceNodeRecord,
  type EvidenceEdgeRecord,
} from '../src/repositories/evidence.repository.js';

function createEvidenceInput(): CreateEvidenceInput {
  return {
    organizationId: '11111111-1111-4111-8111-111111111111',
    findingId: '22222222-2222-4222-8222-222222222222',
    findingOccurrenceId: '33333333-3333-4333-8333-333333333333',
    analysisRunId: '44444444-4444-4444-8444-444444444444',
    repositoryId: '55555555-5555-4555-8555-555555555555',
    commitId: '66666666-6666-4666-8666-666666666666',
    identityFingerprint: 'evidence-identity',
    authority: 'AUTHORITATIVE',
    origin: 'DETERMINISTIC_ANALYZER',
    sufficiency: 'SUFFICIENT',
    completeness: 'COMPLETE',
    analyzerVersions: { sql: '1.0.0' },
    paths: [{ id: 'path-1', nodeIds: ['source', 'sink'], edgeIds: ['edge-1'], completeness: 'COMPLETE', diagnostics: [] }],
    diagnostics: [],
  };
}

function createGraphInput(): EvidenceGraphInput {
  return {
    snapshot: createEvidenceInput(),
    nodes: [{
      organizationId: '11111111-1111-4111-8111-111111111111',
      nodeKey: 'source',
      nodeType: 'SOURCE',
      label: 'request input',
      filePath: 'src/query.ts',
      line: 2,
      attributes: { role: 'source' },
    }, {
      organizationId: '11111111-1111-4111-8111-111111111111',
      nodeKey: 'sink',
      nodeType: 'SINK',
      label: 'database query',
      filePath: 'src/query.ts',
      line: 4,
      attributes: { role: 'sink' },
    }],
    edges: [{
      organizationId: '11111111-1111-4111-8111-111111111111',
      edgeKey: 'edge-1',
      fromNodeKey: 'source',
      toNodeKey: 'sink',
      relation: 'FLOWS_TO',
      resolution: 'EXACT',
      confidence: 'HIGH',
      attributes: {},
    }],
  };
}

function createRepository(): EvidenceRepository {
  const snapshots = new Map<string, EvidenceRecord>();
  const nodes = new Map<string, EvidenceNodeRecord>();
  const edges = new Map<string, EvidenceEdgeRecord>();
  let sequence = 0;

  const query = async (sql: string, values: unknown[] = []) => {
    if (sql.includes('INSERT INTO evidence (')) {
      const [organizationId, findingId, occurrenceId, runId, repositoryId, commitId, fingerprint,
        authority, origin, sufficiency, completeness, complete, versions, pathsJson, diagnosticsJson] = values;
      const key = `${organizationId}|${occurrenceId}|${fingerprint}`;
      if (snapshots.has(key)) return { rows: [] };
      const record: EvidenceRecord = {
        id: `evidence-${++sequence}`,
        organization_id: String(organizationId),
        finding_id: String(findingId),
        finding_occurrence_id: String(occurrenceId),
        analysis_run_id: String(runId),
        repository_id: String(repositoryId),
        commit_id: String(commitId),
        identity_fingerprint: String(fingerprint),
        authority: authority as EvidenceRecord['authority'],
        origin: origin as EvidenceRecord['origin'],
        sufficiency: sufficiency as EvidenceRecord['sufficiency'],
        completeness: completeness as EvidenceRecord['completeness'],
        complete: Boolean(complete),
        analyzer_versions: versions as Record<string, unknown>,
        paths: JSON.parse(String(pathsJson)) as EvidenceRecord['paths'],
        diagnostics: JSON.parse(String(diagnosticsJson)) as string[],
        created_at: new Date(0).toISOString(),
      };
      snapshots.set(key, record);
      return { rows: [record] };
    }

    if (/FROM evidence\s+WHERE organization_id =/.test(sql)) {
      const record = [...snapshots.values()].find((item) =>
        item.organization_id === values[0]
        && (values.length === 2 ? item.id === values[1] : item.finding_occurrence_id === values[1]
          && item.identity_fingerprint === values[2]));
      return { rows: record ? [record] : [] };
    }

    if (sql.includes('INSERT INTO evidence_nodes')) {
      const [organizationId, evidenceId, nodeKey, nodeType, label, filePath, line, endLine, startColumn, endColumn, attributes] = values;
      const key = `${organizationId}|${evidenceId}|${nodeKey}`;
      if (!nodes.has(key)) {
        nodes.set(key, {
          organization_id: String(organizationId),
          evidence_id: String(evidenceId),
          node_key: String(nodeKey),
          node_type: nodeType as EvidenceNodeRecord['node_type'],
          label: String(label),
          file_path: filePath === null ? null : String(filePath),
          line: line === null ? null : Number(line),
          end_line: endLine === null ? null : Number(endLine),
          start_column: startColumn === null ? null : Number(startColumn),
          end_column: endColumn === null ? null : Number(endColumn),
          attributes: attributes as Record<string, unknown>,
        });
      }
      return { rows: [] };
    }

    if (sql.includes('INSERT INTO evidence_edges')) {
      const [organizationId, evidenceId, edgeKey, fromNodeKey, toNodeKey, relation, resolution, confidence, attributes] = values;
      const key = `${organizationId}|${evidenceId}|${edgeKey}`;
      if (!edges.has(key)) {
        edges.set(key, {
          organization_id: String(organizationId),
          evidence_id: String(evidenceId),
          edge_key: String(edgeKey),
          from_node_key: String(fromNodeKey),
          to_node_key: String(toNodeKey),
          relation: String(relation),
          resolution: resolution as EvidenceEdgeRecord['resolution'],
          confidence: confidence as EvidenceEdgeRecord['confidence'],
          attributes: attributes as Record<string, unknown>,
        });
      }
      return { rows: [] };
    }

    if (sql.includes('FROM evidence_nodes')) {
      return { rows: [...nodes.values()]
        .filter((node) => node.organization_id === values[0] && node.evidence_id === values[1])
        .sort((left, right) => left.node_key.localeCompare(right.node_key)) };
    }
    if (sql.includes('FROM evidence_edges')) {
      return { rows: [...edges.values()]
        .filter((edge) => edge.organization_id === values[0] && edge.evidence_id === values[1])
        .sort((left, right) => left.edge_key.localeCompare(right.edge_key)) };
    }
    return { rows: [] };
  };

  const client = {
    query,
    release() {},
  };
  const pool = {
    query,
    async connect() { return client; },
  } as unknown as Pool;
  return new EvidenceRepository(pool);
}

test('evidence snapshot retries reject a conflicting immutable payload', async () => {
  const repository = createRepository();
  const input = createEvidenceInput();
  await repository.createSnapshot(input);

  await assert.rejects(
    repository.createSnapshot({ ...input, completeness: 'PARTIAL' }),
    /Evidence snapshot identity conflict; immutable fields differ: completeness, complete/,
  );
});

test('evidence graph retries are idempotent only when snapshot, nodes, and edges match', async () => {
  const repository = createRepository();
  const input = createGraphInput();
  const first = await repository.createGraph(input);
  const retry = await repository.createGraph(input);

  assert.equal(first.created, true);
  assert.equal(retry.created, false);
  assert.deepEqual(retry.graph, first.graph);
  await assert.rejects(
    repository.createGraph({
      ...input,
      nodes: input.nodes.map((node) => node.nodeKey === 'sink' ? { ...node, label: 'changed label' } : node),
    }),
    /Evidence graph identity conflict; immutable nodes differ/,
  );
});
