import { createHash } from 'node:crypto';

import type { Pool, PoolClient, QueryResultRow } from 'pg';
import { getDatabasePool } from '@bugzero/database';
import type {
  CodeEntityRecord,
  CodeEntityType,
  CodeRelationshipRecord,
  DependencyEdgeRecord,
  DependencyRecord,
} from '@bugzero/database';

export interface CodeGraphScope {
  organizationId: string;
  repositoryId: string;
  commitId: string;
  analysisRunId: string;
}

export type CodeGraphCommitScope = Pick<CodeGraphScope, 'organizationId' | 'repositoryId' | 'commitId'>;

export interface CodeGraphSnapshot {
  entities: CodeEntityRecord[];
  relationships: CodeRelationshipRecord[];
  dependencyEdges?: DependencyEdgeRecord[];
}

export interface LegacyCodeGraphSnapshot {
  entities: CodeEntityRecord[];
  relationships: CodeRelationshipRecord[];
  dependencies: DependencyRecord[];
  dependencyEdges: DependencyEdgeRecord[];
}

export interface CreateDependencyEdgeInput extends CodeGraphScope {
  fromDependencyId: string;
  toDependencyId: string;
  relationship: DependencyEdgeRecord['relationship'];
  resolution: DependencyEdgeRecord['resolution'];
}

function graphId(scope: CodeGraphScope, kind: string, identity: string): string {
  const hex = createHash('sha256')
    .update([scope.organizationId, scope.repositoryId, scope.commitId, scope.analysisRunId, kind, identity].join('\0'))
    .digest('hex')
    .slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20)}`;
}

export function codeGraphEntityId(scope: CodeGraphScope, entityKey: string): string {
  return graphId(scope, 'entity', entityKey);
}

export function codeGraphRelationshipId(
  scope: CodeGraphScope,
  sourceId: string,
  relation: string,
  targetId: string,
): string {
  return graphId(scope, 'relationship', `${sourceId}\0${relation}\0${targetId}`);
}

const entityTypes: readonly CodeEntityType[] = [
  'REPOSITORY', 'FILE', 'MODULE', 'CLASS', 'FUNCTION', 'METHOD', 'SYMBOL',
  'PARAMETER', 'TYPE', 'CONSTANT', 'DEPENDENCY',
];
const relationshipTypes: readonly CodeRelationshipRecord['relation'][] = [
  'IMPORTS', 'DECLARES', 'CALLS', 'REFERENCES', 'READS', 'WRITES', 'RETURNS',
  'PASSES_ARGUMENT', 'INHERITS', 'IMPLEMENTS', 'OVERRIDES', 'DEPENDS_ON', 'DATA_FLOWS_TO',
];
const dependencyEdgeRelationships: readonly DependencyEdgeRecord['relationship'][] = [
  'DEPENDS_ON', 'OPTIONAL_DEPENDENCY', 'PEER_DEPENDENCY',
];
const resolutions: readonly DependencyEdgeRecord['resolution'][] = ['EXACT', 'INFERRED', 'POSSIBLE', 'UNKNOWN'];

function assertScope(scope: CodeGraphScope, record: CodeEntityRecord | CodeRelationshipRecord): void {
  if (
    record.organization_id !== scope.organizationId
    || record.repository_id !== scope.repositoryId
    || record.commit_id !== scope.commitId
    || record.analysis_run_id !== scope.analysisRunId
  ) {
    throw new Error('Code graph record scope does not match its analysis run');
  }
}

function assertDependencyEdgeScope(scope: CodeGraphScope, edge: DependencyEdgeRecord): void {
  if (
    edge.organization_id !== scope.organizationId
    || edge.repository_id !== scope.repositoryId
    || edge.commit_id !== scope.commitId
  ) {
    throw new Error('Dependency edge scope does not match its analysis run');
  }
  if (edge.from_dependency_id === edge.to_dependency_id) {
    throw new Error('Dependency edge cannot point to itself');
  }
  if (!dependencyEdgeRelationships.includes(edge.relationship) || !resolutions.includes(edge.resolution)) {
    throw new Error('Dependency edge has an unsupported relationship or resolution');
  }
}

function asObject(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`PostgreSQL ${name} record contains invalid JSON metadata`);
  }
  return value as Record<string, unknown>;
}

function timestamp(value: unknown, name: string): string {
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) throw new Error(`PostgreSQL ${name} record has an invalid timestamp`);
  return date.toISOString();
}

function nullableInteger(value: unknown, name: string): number | null {
  if (value === null) return null;
  const result = Number(value);
  if (!Number.isSafeInteger(result)) throw new Error(`PostgreSQL ${name} record has an invalid line number`);
  return result;
}

function mapEntity(row: QueryResultRow): CodeEntityRecord {
  if (typeof row.entity_type !== 'string' || !entityTypes.includes(row.entity_type as CodeEntityType)) {
    throw new Error(`PostgreSQL code entity has unsupported type ${String(row.entity_type)}`);
  }
  return {
    id: String(row.id),
    organization_id: String(row.organization_id),
    repository_id: String(row.repository_id),
    commit_id: String(row.commit_id),
    ...(row.analysis_run_id === null || row.analysis_run_id === undefined
      ? {}
      : { analysis_run_id: String(row.analysis_run_id) }),
    entity_key: String(row.entity_key),
    entity_type: row.entity_type as CodeEntityType,
    name: String(row.name),
    qualified_name: row.qualified_name === null ? null : String(row.qualified_name),
    file_path: row.file_path === null ? null : String(row.file_path),
    start_line: nullableInteger(row.start_line, 'code entity start'),
    end_line: nullableInteger(row.end_line, 'code entity end'),
    provenance: asObject(row.provenance, 'code entity'),
    created_at: timestamp(row.created_at, 'code entity'),
  };
}

function mapRelationship(row: QueryResultRow): CodeRelationshipRecord {
  if (typeof row.relation !== 'string' || !relationshipTypes.includes(row.relation as CodeRelationshipRecord['relation'])) {
    throw new Error(`PostgreSQL code relationship has unsupported type ${String(row.relation)}`);
  }
  return {
    id: String(row.id),
    organization_id: String(row.organization_id),
    repository_id: String(row.repository_id),
    commit_id: String(row.commit_id),
    ...(row.analysis_run_id === null || row.analysis_run_id === undefined
      ? {}
      : { analysis_run_id: String(row.analysis_run_id) }),
    source_entity_id: String(row.source_entity_id),
    target_entity_id: String(row.target_entity_id),
    relation: row.relation as CodeRelationshipRecord['relation'],
    resolution: row.resolution as CodeRelationshipRecord['resolution'],
    confidence: row.confidence as CodeRelationshipRecord['confidence'],
    provenance: asObject(row.provenance, 'code relationship'),
    created_at: timestamp(row.created_at, 'code relationship'),
  };
}

function mapDependency(row: QueryResultRow): DependencyRecord {
  if (typeof row.direct !== 'boolean') {
    throw new Error('PostgreSQL dependency record has an invalid direct flag');
  }
  return {
    id: String(row.id),
    organization_id: String(row.organization_id),
    repository_id: String(row.repository_id),
    commit_id: String(row.commit_id),
    package_manager: String(row.package_manager),
    package_name: String(row.package_name),
    version: row.version === null || row.version === undefined ? null : String(row.version),
    manifest_path: String(row.manifest_path),
    direct: row.direct,
    created_at: timestamp(row.created_at, 'dependency'),
  };
}

function mapDependencyEdge(row: QueryResultRow): DependencyEdgeRecord {
  if (
    typeof row.relationship !== 'string'
    || !dependencyEdgeRelationships.includes(row.relationship as DependencyEdgeRecord['relationship'])
  ) {
    throw new Error(`PostgreSQL dependency edge has unsupported relationship ${String(row.relationship)}`);
  }
  if (typeof row.resolution !== 'string' || !resolutions.includes(row.resolution as DependencyEdgeRecord['resolution'])) {
    throw new Error(`PostgreSQL dependency edge has unsupported resolution ${String(row.resolution)}`);
  }
  return {
    id: String(row.id),
    organization_id: String(row.organization_id),
    repository_id: String(row.repository_id),
    commit_id: String(row.commit_id),
    from_dependency_id: String(row.from_dependency_id),
    to_dependency_id: String(row.to_dependency_id),
    relationship: row.relationship as DependencyEdgeRecord['relationship'],
    resolution: row.resolution as DependencyEdgeRecord['resolution'],
    created_at: timestamp(row.created_at, 'dependency edge'),
  };
}

async function setTenant(client: PoolClient, organizationId: string): Promise<void> {
  await client.query("SELECT set_config('app.organization_id', $1, true)", [organizationId]);
}

async function inTenantTransaction<T>(
  pool: Pool,
  organizationId: string,
  operation: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await setTenant(client, organizationId);
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      throw new AggregateError([error, rollbackError], 'Code graph transaction and rollback failed');
    }
    throw error;
  } finally {
    client.release();
  }
}

function assertAffectedRows(actual: number | null, expected: number, kind: string): void {
  if (actual !== expected) {
    throw new Error(`PostgreSQL persisted ${actual ?? 0} of ${expected} ${kind}; a run-scoped identity conflict may exist`);
  }
}

function splitRelationships(relationships: CodeRelationshipRecord[]): {
  code: CodeRelationshipRecord[];
  flows: CodeRelationshipRecord[];
} {
  return {
    code: relationships.filter((relationship) => relationship.relation !== 'DATA_FLOWS_TO'),
    flows: relationships.filter((relationship) => relationship.relation === 'DATA_FLOWS_TO'),
  };
}

function deduplicateRelationships(
  relationships: CodeRelationshipRecord[],
  identity: (relationship: CodeRelationshipRecord) => string,
  kind: string,
): CodeRelationshipRecord[] {
  const unique = new Map<string, CodeRelationshipRecord>();
  for (const relationship of relationships) {
    const key = identity(relationship);
    const existing = unique.get(key);
    if (existing && existing.id !== relationship.id) {
      throw new Error(`Duplicate ${kind} graph identity has conflicting record IDs`);
    }
    if (!existing) unique.set(key, relationship);
  }
  return [...unique.values()];
}

function deduplicateDependencyEdges(edges: DependencyEdgeRecord[]): DependencyEdgeRecord[] {
  const uniqueById = new Map<string, DependencyEdgeRecord>();
  const uniqueByIdentity = new Map<string, DependencyEdgeRecord>();
  for (const edge of edges) {
    const existingId = uniqueById.get(edge.id);
    if (existingId) {
      if (
        existingId.organization_id !== edge.organization_id
        || existingId.repository_id !== edge.repository_id
        || existingId.commit_id !== edge.commit_id
        || existingId.from_dependency_id !== edge.from_dependency_id
        || existingId.to_dependency_id !== edge.to_dependency_id
        || existingId.relationship !== edge.relationship
        || existingId.resolution !== edge.resolution
        || existingId.created_at !== edge.created_at
      ) {
        throw new Error('Duplicate dependency edge ID has conflicting payloads');
      }
      continue;
    }

    const identity = JSON.stringify([edge.from_dependency_id, edge.to_dependency_id, edge.relationship]);
    const existingIdentity = uniqueByIdentity.get(identity);
    if (existingIdentity) {
      throw new Error('Duplicate dependency edge identity has conflicting record IDs');
    }
    uniqueById.set(edge.id, edge);
    uniqueByIdentity.set(identity, edge);
  }
  return [...uniqueById.values()];
}

export class CodeGraphRepository {
  constructor(private readonly pool: Pool = getDatabasePool()) {}

  async close(): Promise<void> {}

  async writeSnapshot(scope: CodeGraphScope, snapshot: CodeGraphSnapshot): Promise<void> {
    const dependencyEdges = deduplicateDependencyEdges(snapshot.dependencyEdges ?? []);
    const entitiesById = new Map(snapshot.entities.map((entity) => [entity.id, entity]));
    for (const entity of snapshot.entities) assertScope(scope, entity);
    for (const relationship of snapshot.relationships) {
      assertScope(scope, relationship);
      if (!entitiesById.has(relationship.source_entity_id) || !entitiesById.has(relationship.target_entity_id)) {
        throw new Error('Code graph relationship endpoint is missing from its analysis run');
      }
    }
    for (const edge of dependencyEdges) {
      assertDependencyEdgeScope(scope, edge);
      if (
        entitiesById.get(edge.from_dependency_id)?.entity_type !== 'DEPENDENCY'
        || entitiesById.get(edge.to_dependency_id)?.entity_type !== 'DEPENDENCY'
      ) {
        throw new Error('Dependency edge endpoints must be dependency entities in its analysis run');
      }
    }

    await inTenantTransaction(this.pool, scope.organizationId, async (client) => {
      await this.upsertEntities(client, snapshot.entities);
      await this.upsertDependencies(client, snapshot.entities.filter((entity) => entity.entity_type === 'DEPENDENCY'));
      await this.upsertRelationships(client, snapshot.relationships);
      await this.upsertDependencyEdges(client, scope, dependencyEdges);
    });
  }

  async createDependencyEdge(input: CreateDependencyEdgeInput): Promise<DependencyEdgeRecord> {
    const scope: CodeGraphScope = {
      organizationId: input.organizationId,
      repositoryId: input.repositoryId,
      commitId: input.commitId,
      analysisRunId: input.analysisRunId,
    };
    const edge: DependencyEdgeRecord = {
      id: graphId(
        scope,
        'dependency-edge',
        JSON.stringify([input.fromDependencyId, input.toDependencyId, input.relationship]),
      ),
      organization_id: input.organizationId,
      repository_id: input.repositoryId,
      commit_id: input.commitId,
      from_dependency_id: input.fromDependencyId,
      to_dependency_id: input.toDependencyId,
      relationship: input.relationship,
      resolution: input.resolution,
      created_at: new Date().toISOString(),
    };
    assertDependencyEdgeScope(scope, edge);
    return inTenantTransaction(this.pool, scope.organizationId, async (client) => {
      await this.upsertDependencyEdges(client, scope, [edge]);
      const persisted = (await this.selectDependencyEdgesByRun(client, scope)).find(({ id }) => id === edge.id);
      if (!persisted) throw new Error('PostgreSQL did not return the created dependency edge');
      return persisted;
    });
  }

  async writeDependencyEdges(scope: CodeGraphScope, edges: DependencyEdgeRecord[]): Promise<void> {
    const uniqueEdges = deduplicateDependencyEdges(edges);
    for (const edge of uniqueEdges) assertDependencyEdgeScope(scope, edge);
    await inTenantTransaction(this.pool, scope.organizationId, (client) =>
      this.upsertDependencyEdges(client, scope, uniqueEdges));
  }

  async writeRelationships(scope: CodeGraphScope, relationships: CodeRelationshipRecord[]): Promise<void> {
    for (const relationship of relationships) assertScope(scope, relationship);
    await inTenantTransaction(this.pool, scope.organizationId, (client) =>
      this.upsertRelationships(client, relationships));
  }

  async listByRun(scope: CodeGraphScope): Promise<CodeGraphSnapshot> {
    return inTenantTransaction(this.pool, scope.organizationId, async (client) => {
      const [entities, relationships, dataFlows, dependencyEdges] = await Promise.all([
        client.query(
          `SELECT * FROM code_entities
           WHERE organization_id = $1 AND repository_id = $2 AND commit_id = $3 AND analysis_run_id = $4
           ORDER BY file_path NULLS FIRST, start_line NULLS FIRST, name`,
          [scope.organizationId, scope.repositoryId, scope.commitId, scope.analysisRunId],
        ),
        client.query(
          `SELECT * FROM code_relationships
           WHERE organization_id = $1 AND repository_id = $2 AND commit_id = $3 AND analysis_run_id = $4
           ORDER BY created_at, id`,
          [scope.organizationId, scope.repositoryId, scope.commitId, scope.analysisRunId],
        ),
        client.query(
          `SELECT id, organization_id, repository_id, commit_id, analysis_run_id,
                  source_entity_id, target_entity_id, 'DATA_FLOWS_TO' AS relation,
                  resolution, confidence, provenance, created_at
           FROM data_flow_edges
           WHERE organization_id = $1 AND repository_id = $2 AND commit_id = $3 AND analysis_run_id = $4
           ORDER BY created_at, id`,
          [scope.organizationId, scope.repositoryId, scope.commitId, scope.analysisRunId],
        ),
        this.selectDependencyEdgesByRun(client, scope),
      ]);
      return {
        entities: entities.rows.map(mapEntity),
        relationships: [...relationships.rows, ...dataFlows.rows].map(mapRelationship),
        dependencyEdges,
      };
    });
  }

  async listDependencyEdgesByRun(scope: CodeGraphScope): Promise<DependencyEdgeRecord[]> {
    return inTenantTransaction(this.pool, scope.organizationId, (client) =>
      this.selectDependencyEdgesByRun(client, scope));
  }

  async listLegacyByCommit(scope: CodeGraphCommitScope): Promise<LegacyCodeGraphSnapshot> {
    return inTenantTransaction(this.pool, scope.organizationId, async (client) => {
      const [entities, relationships, dependencies, dependencyEdges] = await Promise.all([
        client.query(
          `SELECT * FROM code_entities
           WHERE organization_id = $1 AND repository_id = $2 AND commit_id = $3 AND analysis_run_id IS NULL
           ORDER BY file_path NULLS FIRST, start_line NULLS FIRST, name`,
          [scope.organizationId, scope.repositoryId, scope.commitId],
        ),
        client.query(
          `SELECT * FROM code_relationships
           WHERE organization_id = $1 AND repository_id = $2 AND commit_id = $3 AND analysis_run_id IS NULL
           ORDER BY created_at, id`,
          [scope.organizationId, scope.repositoryId, scope.commitId],
        ),
        client.query(
          `SELECT * FROM dependencies
           WHERE organization_id = $1 AND repository_id = $2 AND commit_id = $3 AND analysis_run_id IS NULL
           ORDER BY package_name, created_at, id`,
          [scope.organizationId, scope.repositoryId, scope.commitId],
        ),
        client.query(
          `SELECT * FROM dependency_edges
           WHERE organization_id = $1 AND repository_id = $2 AND commit_id = $3 AND analysis_run_id IS NULL
           ORDER BY created_at, id`,
          [scope.organizationId, scope.repositoryId, scope.commitId],
        ),
      ]);
      return {
        entities: entities.rows.map(mapEntity),
        relationships: relationships.rows.map(mapRelationship),
        dependencies: dependencies.rows.map(mapDependency),
        dependencyEdges: dependencyEdges.rows.map(mapDependencyEdge),
      };
    });
  }

  private async selectDependencyEdgesByRun(
    client: PoolClient,
    scope: CodeGraphScope,
  ): Promise<DependencyEdgeRecord[]> {
    const result = await client.query(
      `SELECT * FROM dependency_edges
       WHERE organization_id = $1 AND repository_id = $2 AND commit_id = $3 AND analysis_run_id = $4
       ORDER BY created_at, id`,
      [scope.organizationId, scope.repositoryId, scope.commitId, scope.analysisRunId],
    );
    return result.rows.map(mapDependencyEdge);
  }

  private async upsertEntities(client: PoolClient, entities: CodeEntityRecord[]): Promise<void> {
    for (const batch of batches(entities, 500)) {
      if (batch.length === 0) continue;
      const result = await client.query(
        `INSERT INTO code_entities (
           id, organization_id, repository_id, commit_id, analysis_run_id, entity_key,
           entity_type, name, qualified_name, file_path, start_line, end_line, provenance, created_at
         )
         SELECT id, organization_id, repository_id, commit_id, analysis_run_id, entity_key,
                entity_type, name, qualified_name, file_path, start_line, end_line, provenance, created_at
         FROM jsonb_to_recordset($1::jsonb) AS rows(
           id uuid, organization_id uuid, repository_id uuid, commit_id uuid, analysis_run_id uuid,
           entity_key text, entity_type text, name text, qualified_name text, file_path text,
           start_line integer, end_line integer, provenance jsonb, created_at timestamptz
         )
         ON CONFLICT (organization_id, repository_id, commit_id, analysis_run_id, entity_key)
           WHERE analysis_run_id IS NOT NULL
         DO UPDATE SET entity_type = EXCLUDED.entity_type, name = EXCLUDED.name,
           qualified_name = EXCLUDED.qualified_name, file_path = EXCLUDED.file_path,
           start_line = EXCLUDED.start_line, end_line = EXCLUDED.end_line,
           provenance = EXCLUDED.provenance
         WHERE code_entities.id = EXCLUDED.id`,
        [JSON.stringify(batch)],
      );
      assertAffectedRows(result.rowCount, batch.length, 'code entities');
    }
  }

  private async upsertDependencies(client: PoolClient, dependencies: CodeEntityRecord[]): Promise<void> {
    for (const batch of batches(dependencies, 500)) {
      if (batch.length === 0) continue;
      const result = await client.query(
        `INSERT INTO dependencies (
           id, organization_id, repository_id, commit_id, analysis_run_id, package_manager,
           package_name, version, manifest_path, dependency_group, direct, created_at
         )
         SELECT id, organization_id, repository_id, commit_id, analysis_run_id, package_manager,
                package_name, version, manifest_path, dependency_group, direct, created_at
         FROM jsonb_to_recordset($1::jsonb) AS rows(
           id uuid, organization_id uuid, repository_id uuid, commit_id uuid, analysis_run_id uuid,
           package_manager text, package_name text, version text, manifest_path text,
           dependency_group text, direct boolean, created_at timestamptz
         )
         ON CONFLICT (
           organization_id, repository_id, commit_id, analysis_run_id,
           package_manager, package_name, manifest_path, dependency_group
         ) WHERE analysis_run_id IS NOT NULL
         DO UPDATE SET version = EXCLUDED.version, direct = EXCLUDED.direct
         WHERE dependencies.id = EXCLUDED.id`,
        [JSON.stringify(batch.map((entity) => ({
          id: entity.id,
          organization_id: entity.organization_id,
          repository_id: entity.repository_id,
          commit_id: entity.commit_id,
          analysis_run_id: entity.analysis_run_id,
          package_manager: entity.provenance.packageManager,
          package_name: entity.name,
          version: entity.provenance.versionRange ?? null,
          manifest_path: entity.file_path,
          dependency_group: entity.provenance.dependencyGroup ?? 'unknown',
          direct: entity.provenance.direct === true,
          created_at: entity.created_at,
        })))],
      );
      assertAffectedRows(result.rowCount, batch.length, 'dependencies');
    }
  }

  private async upsertDependencyEdges(
    client: PoolClient,
    scope: CodeGraphScope,
    edges: DependencyEdgeRecord[],
  ): Promise<void> {
    for (const batch of batches(edges, 500)) {
      if (batch.length === 0) continue;
      const result = await client.query(
        `INSERT INTO dependency_edges (
           id, organization_id, repository_id, commit_id, analysis_run_id,
           from_dependency_id, to_dependency_id, relationship, resolution, created_at
         )
         SELECT id, organization_id, repository_id, commit_id, analysis_run_id,
                from_dependency_id, to_dependency_id, relationship, resolution, created_at
         FROM jsonb_to_recordset($1::jsonb) AS rows(
           id uuid, organization_id uuid, repository_id uuid, commit_id uuid, analysis_run_id uuid,
           from_dependency_id uuid, to_dependency_id uuid, relationship text, resolution text,
           created_at timestamptz
         )
         ON CONFLICT (
           organization_id, repository_id, commit_id, analysis_run_id,
           from_dependency_id, to_dependency_id, relationship
         ) WHERE analysis_run_id IS NOT NULL
         DO UPDATE SET resolution = EXCLUDED.resolution
         WHERE dependency_edges.id = EXCLUDED.id`,
        [JSON.stringify(batch.map((edge) => ({
          ...edge,
          analysis_run_id: scope.analysisRunId,
        })))],
      );
      assertAffectedRows(result.rowCount, batch.length, 'dependency edges');
    }
  }

  private async upsertRelationships(
    client: PoolClient,
    relationships: CodeRelationshipRecord[],
  ): Promise<void> {
    const split = splitRelationships(relationships);
    const code = deduplicateRelationships(
      split.code,
      (relationship) => JSON.stringify([
        relationship.source_entity_id,
        relationship.target_entity_id,
        relationship.relation,
      ]),
      'code relationship',
    );
    const flows = deduplicateRelationships(
      split.flows,
      (relationship) => JSON.stringify([
        relationship.source_entity_id,
        relationship.target_entity_id,
        relationship.provenance.ruleId,
        relationship.provenance.evidencePathId,
      ]),
      'data-flow relationship',
    );
    for (const batch of batches(code, 500)) {
      if (batch.length === 0) continue;
      const result = await client.query(
        `INSERT INTO code_relationships (
           id, organization_id, repository_id, commit_id, analysis_run_id,
           source_entity_id, target_entity_id, relation, resolution, confidence, provenance, created_at
         )
         SELECT id, organization_id, repository_id, commit_id, analysis_run_id,
                source_entity_id, target_entity_id, relation, resolution, confidence, provenance, created_at
         FROM jsonb_to_recordset($1::jsonb) AS rows(
           id uuid, organization_id uuid, repository_id uuid, commit_id uuid, analysis_run_id uuid,
           source_entity_id uuid, target_entity_id uuid, relation text, resolution text,
           confidence text, provenance jsonb, created_at timestamptz
         )
         ON CONFLICT (
           organization_id, repository_id, commit_id, analysis_run_id,
           source_entity_id, target_entity_id, relation
         ) WHERE analysis_run_id IS NOT NULL
         DO UPDATE SET resolution = EXCLUDED.resolution, confidence = EXCLUDED.confidence,
           provenance = EXCLUDED.provenance
         WHERE code_relationships.id = EXCLUDED.id`,
        [JSON.stringify(batch)],
      );
      assertAffectedRows(result.rowCount, batch.length, 'code relationships');
    }
    for (const batch of batches(flows, 500)) {
      if (batch.length === 0) continue;
      const result = await client.query(
        `INSERT INTO data_flow_edges (
           id, organization_id, repository_id, commit_id, analysis_run_id,
           source_entity_id, target_entity_id, rule_id, evidence_path_id,
           resolution, confidence, provenance, created_at
         )
         SELECT id, organization_id, repository_id, commit_id, analysis_run_id,
                source_entity_id, target_entity_id, rule_id, evidence_path_id,
                resolution, confidence, provenance, created_at
         FROM jsonb_to_recordset($1::jsonb) AS rows(
           id uuid, organization_id uuid, repository_id uuid, commit_id uuid, analysis_run_id uuid,
           source_entity_id uuid, target_entity_id uuid, rule_id text, evidence_path_id text,
           resolution text, confidence text, provenance jsonb, created_at timestamptz
         )
         ON CONFLICT (
           organization_id, repository_id, commit_id, analysis_run_id,
           source_entity_id, target_entity_id, rule_id, evidence_path_id
         ) DO UPDATE SET resolution = EXCLUDED.resolution, confidence = EXCLUDED.confidence,
           provenance = EXCLUDED.provenance
         WHERE data_flow_edges.id = EXCLUDED.id`,
        [JSON.stringify(batch.map((relationship) => ({
          id: relationship.id,
          organization_id: relationship.organization_id,
          repository_id: relationship.repository_id,
          commit_id: relationship.commit_id,
          analysis_run_id: relationship.analysis_run_id,
          source_entity_id: relationship.source_entity_id,
          target_entity_id: relationship.target_entity_id,
          rule_id: relationship.provenance.ruleId,
          evidence_path_id: relationship.provenance.evidencePathId,
          resolution: relationship.resolution,
          confidence: relationship.confidence,
          provenance: relationship.provenance,
          created_at: relationship.created_at,
        })))],
      );
      assertAffectedRows(result.rowCount, batch.length, 'data-flow edges');
    }
  }
}

function batches<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

export const codeGraphRepository = new CodeGraphRepository();
