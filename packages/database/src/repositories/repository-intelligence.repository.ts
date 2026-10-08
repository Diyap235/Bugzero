import type { Pool } from 'pg';

import { getDatabasePool } from '../client/postgres.js';
import type { CodeEntityRecord, CodeRelationshipRecord } from './code-ir.repository.js';

export interface RepositoryIntelligenceEntityQuery {
  organizationId: string;
  repositoryId: string;
  commitId: string;
}

export class RepositoryIntelligenceRepository {
  constructor(private readonly pool: Pool = getDatabasePool()) {}

  async getEntity(organizationId: string, repositoryId: string, commitId: string, entityId: string): Promise<CodeEntityRecord | null> {
    const result = await this.pool.query<CodeEntityRecord>(
      'SELECT * FROM code_entities WHERE organization_id = $1 AND repository_id = $2 AND commit_id = $3 AND id = $4',
      [organizationId, repositoryId, commitId, entityId],
    );

    return result.rows[0] ?? null;
  }

  async findEntityByQualifiedName(organizationId: string, repositoryId: string, commitId: string, qualifiedName: string): Promise<CodeEntityRecord | null> {
    const result = await this.pool.query<CodeEntityRecord>(
      'SELECT * FROM code_entities WHERE organization_id = $1 AND repository_id = $2 AND commit_id = $3 AND qualified_name = $4 LIMIT 1',
      [organizationId, repositoryId, commitId, qualifiedName],
    );

    return result.rows[0] ?? null;
  }

  async findEntitiesByFile(organizationId: string, repositoryId: string, commitId: string, filePath: string): Promise<CodeEntityRecord[]> {
    const result = await this.pool.query<CodeEntityRecord>(
      'SELECT * FROM code_entities WHERE organization_id = $1 AND repository_id = $2 AND commit_id = $3 AND file_path = $4 ORDER BY name ASC',
      [organizationId, repositoryId, commitId, filePath],
    );

    return result.rows;
  }

  async findEntitiesByKind(organizationId: string, repositoryId: string, commitId: string, entityType: string): Promise<CodeEntityRecord[]> {
    const result = await this.pool.query<CodeEntityRecord>(
      'SELECT * FROM code_entities WHERE organization_id = $1 AND repository_id = $2 AND commit_id = $3 AND entity_type = $4 ORDER BY qualified_name ASC',
      [organizationId, repositoryId, commitId, entityType],
    );

    return result.rows;
  }

  async getOutgoingRelationships(organizationId: string, repositoryId: string, commitId: string, sourceEntityId?: string): Promise<CodeRelationshipRecord[]> {
    if (sourceEntityId) {
      const result = await this.pool.query<CodeRelationshipRecord>(
        'SELECT * FROM code_relationships WHERE organization_id = $1 AND repository_id = $2 AND commit_id = $3 AND source_entity_id = $4 ORDER BY created_at ASC',
        [organizationId, repositoryId, commitId, sourceEntityId],
      );

      return result.rows;
    }

    const result = await this.pool.query<CodeRelationshipRecord>(
      'SELECT * FROM code_relationships WHERE organization_id = $1 AND repository_id = $2 AND commit_id = $3 ORDER BY created_at ASC',
      [organizationId, repositoryId, commitId],
    );

    return result.rows;
  }

  async getIncomingRelationships(organizationId: string, repositoryId: string, commitId: string, targetEntityId?: string): Promise<CodeRelationshipRecord[]> {
    if (targetEntityId) {
      const result = await this.pool.query<CodeRelationshipRecord>(
        'SELECT * FROM code_relationships WHERE organization_id = $1 AND repository_id = $2 AND commit_id = $3 AND target_entity_id = $4 ORDER BY created_at ASC',
        [organizationId, repositoryId, commitId, targetEntityId],
      );

      return result.rows;
    }

    const result = await this.pool.query<CodeRelationshipRecord>(
      'SELECT * FROM code_relationships WHERE organization_id = $1 AND repository_id = $2 AND commit_id = $3 ORDER BY created_at ASC',
      [organizationId, repositoryId, commitId],
    );

    return result.rows;
  }

  async getCallers(organizationId: string, repositoryId: string, commitId: string, entityId: string): Promise<CodeRelationshipRecord[]> {
    return this.getIncomingRelationships(organizationId, repositoryId, commitId, entityId).then((rows) => rows.filter((row) => row.relation === 'CALLS'));
  }

  async getCallees(organizationId: string, repositoryId: string, commitId: string, entityId: string): Promise<CodeRelationshipRecord[]> {
    return this.getOutgoingRelationships(organizationId, repositoryId, commitId, entityId).then((rows) => rows.filter((row) => row.relation === 'CALLS'));
  }

  async getImports(organizationId: string, repositoryId: string, commitId: string, entityId: string): Promise<CodeRelationshipRecord[]> {
    return this.getOutgoingRelationships(organizationId, repositoryId, commitId, entityId).then((rows) => rows.filter((row) => row.relation === 'IMPORTS'));
  }

  async getImporters(organizationId: string, repositoryId: string, commitId: string, entityId: string): Promise<CodeRelationshipRecord[]> {
    return this.getIncomingRelationships(organizationId, repositoryId, commitId, entityId).then((rows) => rows.filter((row) => row.relation === 'IMPORTS'));
  }

  async getReferences(organizationId: string, repositoryId: string, commitId: string, entityId: string): Promise<CodeRelationshipRecord[]> {
    return this.getOutgoingRelationships(organizationId, repositoryId, commitId, entityId).then((rows) => rows.filter((row) => row.relation === 'REFERENCES'));
  }

  async getReverseReferences(organizationId: string, repositoryId: string, commitId: string, entityId: string): Promise<CodeRelationshipRecord[]> {
    return this.getIncomingRelationships(organizationId, repositoryId, commitId, entityId).then((rows) => rows.filter((row) => row.relation === 'REFERENCES'));
  }
}

export const repositoryIntelligenceRepository = new RepositoryIntelligenceRepository();
