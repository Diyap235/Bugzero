import type { Pool } from 'pg';

import { getDatabasePool } from '../client/postgres.js';

export type CodeEntityType =
  | 'REPOSITORY'
  | 'FILE'
  | 'MODULE'
  | 'CLASS'
  | 'FUNCTION'
  | 'METHOD'
  | 'SYMBOL'
  | 'PARAMETER'
  | 'TYPE'
  | 'CONSTANT';

export interface CodeEntityRecord {
  id: string;
  organization_id: string;
  repository_id: string;
  commit_id: string;
  entity_key: string;
  entity_type: CodeEntityType;
  name: string;
  qualified_name: string | null;
  file_path: string | null;
  start_line: number | null;
  end_line: number | null;
  provenance: Record<string, unknown>;
  created_at: string;
}

export interface CodeRelationshipRecord {
  id: string;
  organization_id: string;
  repository_id: string;
  commit_id: string;
  source_entity_id: string;
  target_entity_id: string;
  relation: 'IMPORTS' | 'DECLARES' | 'CALLS' | 'REFERENCES' | 'READS' | 'WRITES' | 'RETURNS' | 'PASSES_ARGUMENT' | 'INHERITS' | 'IMPLEMENTS' | 'OVERRIDES';
  resolution: 'EXACT' | 'INFERRED' | 'POSSIBLE' | 'UNKNOWN';
  confidence: 'LOW' | 'MEDIUM' | 'HIGH' | null;
  provenance: Record<string, unknown>;
  created_at: string;
}

export interface CreateCodeEntityInput {
  organizationId: string;
  repositoryId: string;
  commitId: string;
  entityKey: string;
  entityType: CodeEntityType;
  name: string;
  qualifiedName?: string | null;
  filePath?: string | null;
  startLine?: number | null;
  endLine?: number | null;
  provenance?: Record<string, unknown>;
}

export interface CreateCodeRelationshipInput {
  organizationId: string;
  repositoryId: string;
  commitId: string;
  sourceEntityId: string;
  targetEntityId: string;
  relation: CodeRelationshipRecord['relation'];
  resolution: CodeRelationshipRecord['resolution'];
  confidence?: CodeRelationshipRecord['confidence'];
  provenance?: Record<string, unknown>;
}

export class CodeEntityRepository {
  constructor(private readonly pool: Pool = getDatabasePool()) {}

  async create(input: CreateCodeEntityInput): Promise<CodeEntityRecord> {
    const result = await this.pool.query<CodeEntityRecord>(
      `INSERT INTO code_entities (
        organization_id,
        repository_id,
        commit_id,
        entity_key,
        entity_type,
        name,
        qualified_name,
        file_path,
        start_line,
        end_line,
        provenance
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [
        input.organizationId,
        input.repositoryId,
        input.commitId,
        input.entityKey,
        input.entityType,
        input.name,
        input.qualifiedName ?? null,
        input.filePath ?? null,
        input.startLine ?? null,
        input.endLine ?? null,
        input.provenance ?? {},
      ],
    );

    return result.rows[0];
  }

  async createOrUpdate(input: CreateCodeEntityInput): Promise<CodeEntityRecord> {
    const result = await this.pool.query<CodeEntityRecord>(
      `INSERT INTO code_entities (
        organization_id,
        repository_id,
        commit_id,
        entity_key,
        entity_type,
        name,
        qualified_name,
        file_path,
        start_line,
        end_line,
        provenance
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (organization_id, commit_id, entity_key) DO UPDATE
       SET entity_type = EXCLUDED.entity_type,
           name = EXCLUDED.name,
           qualified_name = EXCLUDED.qualified_name,
           file_path = EXCLUDED.file_path,
           start_line = EXCLUDED.start_line,
           end_line = EXCLUDED.end_line,
           provenance = EXCLUDED.provenance
       RETURNING *`,
      [
        input.organizationId,
        input.repositoryId,
        input.commitId,
        input.entityKey,
        input.entityType,
        input.name,
        input.qualifiedName ?? null,
        input.filePath ?? null,
        input.startLine ?? null,
        input.endLine ?? null,
        input.provenance ?? {},
      ],
    );
    return result.rows[0];
  }

  async listByCommit(organizationId: string, repositoryId: string, commitId: string): Promise<CodeEntityRecord[]> {
    const result = await this.pool.query<CodeEntityRecord>(
      'SELECT * FROM code_entities WHERE organization_id = $1 AND repository_id = $2 AND commit_id = $3 ORDER BY created_at ASC',
      [organizationId, repositoryId, commitId],
    );

    return result.rows;
  }
}

export class CodeRelationshipRepository {
  constructor(private readonly pool: Pool = getDatabasePool()) {}

  async create(input: CreateCodeRelationshipInput): Promise<CodeRelationshipRecord> {
    const result = await this.pool.query<CodeRelationshipRecord>(
      `INSERT INTO code_relationships (
        organization_id,
        repository_id,
        commit_id,
        source_entity_id,
        target_entity_id,
        relation,
        resolution,
        confidence,
        provenance
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        input.organizationId,
        input.repositoryId,
        input.commitId,
        input.sourceEntityId,
        input.targetEntityId,
        input.relation,
        input.resolution,
        input.confidence ?? null,
        input.provenance ?? {},
      ],
    );

    return result.rows[0];
  }

  async createOrGet(input: CreateCodeRelationshipInput): Promise<CodeRelationshipRecord> {
    const result = await this.pool.query<CodeRelationshipRecord>(
      `INSERT INTO code_relationships (
        organization_id,
        repository_id,
        commit_id,
        source_entity_id,
        target_entity_id,
        relation,
        resolution,
        confidence,
        provenance
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (organization_id, repository_id, commit_id, source_entity_id, target_entity_id, relation)
       DO UPDATE SET resolution = EXCLUDED.resolution,
                     confidence = EXCLUDED.confidence,
                     provenance = EXCLUDED.provenance
       RETURNING *`,
      [
        input.organizationId,
        input.repositoryId,
        input.commitId,
        input.sourceEntityId,
        input.targetEntityId,
        input.relation,
        input.resolution,
        input.confidence ?? null,
        input.provenance ?? {},
      ],
    );
    return result.rows[0];
  }

  async listByCommit(organizationId: string, repositoryId: string, commitId: string): Promise<CodeRelationshipRecord[]> {
    const result = await this.pool.query<CodeRelationshipRecord>(
      'SELECT * FROM code_relationships WHERE organization_id = $1 AND repository_id = $2 AND commit_id = $3 ORDER BY created_at ASC',
      [organizationId, repositoryId, commitId],
    );

    return result.rows;
  }
}

export const codeEntityRepository = new CodeEntityRepository();
export const codeRelationshipRepository = new CodeRelationshipRepository();
