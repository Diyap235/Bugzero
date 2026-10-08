import type { Pool } from 'pg';

import { getDatabasePool } from '../client/postgres.js';

export interface DependencyRecord {
  id: string;
  organization_id: string;
  repository_id: string;
  commit_id: string;
  package_manager: string;
  package_name: string;
  version: string | null;
  manifest_path: string;
  direct: boolean;
  created_at: string;
}

export interface DependencyEdgeRecord {
  id: string;
  organization_id: string;
  repository_id: string;
  commit_id: string;
  from_dependency_id: string;
  to_dependency_id: string;
  relationship: 'DEPENDS_ON' | 'OPTIONAL_DEPENDENCY' | 'PEER_DEPENDENCY';
  resolution: 'EXACT' | 'INFERRED' | 'POSSIBLE' | 'UNKNOWN';
  created_at: string;
}

export interface CreateDependencyInput {
  organizationId: string;
  repositoryId: string;
  commitId: string;
  packageManager: string;
  packageName: string;
  version?: string | null;
  manifestPath: string;
  direct: boolean;
}

export class DependencyRepository {
  constructor(private readonly pool: Pool = getDatabasePool()) {}

  async createDependency(input: CreateDependencyInput): Promise<DependencyRecord> {
    const result = await this.pool.query<DependencyRecord>(
      `INSERT INTO dependencies (organization_id, repository_id, commit_id, package_manager, package_name, version, manifest_path, direct)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        input.organizationId,
        input.repositoryId,
        input.commitId,
        input.packageManager,
        input.packageName,
        input.version ?? null,
        input.manifestPath,
        input.direct,
      ],
    );

    return result.rows[0];
  }

  async listByCommit(organizationId: string, repositoryId: string, commitId: string): Promise<DependencyRecord[]> {
    const result = await this.pool.query<DependencyRecord>(
      'SELECT * FROM dependencies WHERE organization_id = $1 AND repository_id = $2 AND commit_id = $3 ORDER BY package_name ASC',
      [organizationId, repositoryId, commitId],
    );

    return result.rows;
  }

  async createEdge(input: {
    organizationId: string;
    repositoryId: string;
    commitId: string;
    fromDependencyId: string;
    toDependencyId: string;
    relationship: 'DEPENDS_ON' | 'OPTIONAL_DEPENDENCY' | 'PEER_DEPENDENCY';
    resolution: 'EXACT' | 'INFERRED' | 'POSSIBLE' | 'UNKNOWN';
  }): Promise<DependencyEdgeRecord> {
    const result = await this.pool.query<DependencyEdgeRecord>(
      `INSERT INTO dependency_edges (organization_id, repository_id, commit_id, from_dependency_id, to_dependency_id, relationship, resolution)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        input.organizationId,
        input.repositoryId,
        input.commitId,
        input.fromDependencyId,
        input.toDependencyId,
        input.relationship,
        input.resolution,
      ],
    );

    return result.rows[0];
  }

  async listEdgesByCommit(organizationId: string, repositoryId: string, commitId: string): Promise<DependencyEdgeRecord[]> {
    const result = await this.pool.query<DependencyEdgeRecord>(
      'SELECT * FROM dependency_edges WHERE organization_id = $1 AND repository_id = $2 AND commit_id = $3 ORDER BY created_at ASC',
      [organizationId, repositoryId, commitId],
    );

    return result.rows;
  }
}

export const dependenciesRepository = new DependencyRepository();
