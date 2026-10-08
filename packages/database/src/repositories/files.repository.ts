import type { Pool } from 'pg';

import { getDatabasePool } from '../client/postgres.js';

export interface RepositoryFileRecord {
  id: string;
  organization_id: string;
  repository_id: string;
  commit_id: string;
  path: string;
  content_sha256: string;
  size_bytes: number;
  language: string | null;
  object_key: string | null;
  source_content: string | null;
  created_at: string;
}

export interface CreateRepositoryFileInput {
  organizationId: string;
  repositoryId: string;
  commitId: string;
  path: string;
  contentSha256: string;
  sizeBytes: number;
  language?: string | null;
  objectKey?: string | null;
  sourceContent?: string | null;
}

export class RepositoryFileRepository {
  constructor(private readonly pool: Pool = getDatabasePool()) {}

  async create(input: CreateRepositoryFileInput): Promise<RepositoryFileRecord> {
    const result = await this.pool.query<RepositoryFileRecord>(
      `INSERT INTO repository_files (organization_id, repository_id, commit_id, path, content_sha256, size_bytes, language, object_key, source_content)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        input.organizationId,
        input.repositoryId,
        input.commitId,
        input.path,
        input.contentSha256,
        input.sizeBytes,
        input.language ?? null,
        input.objectKey ?? null,
        input.sourceContent ?? null,
      ],
    );

    return result.rows[0];
  }

  async listByCommit(organizationId: string, repositoryId: string, commitId: string): Promise<RepositoryFileRecord[]> {
    const result = await this.pool.query<RepositoryFileRecord>(
      'SELECT * FROM repository_files WHERE organization_id = $1 AND repository_id = $2 AND commit_id = $3 ORDER BY path ASC',
      [organizationId, repositoryId, commitId],
    );

    return result.rows;
  }
}

export const repositoryFilesRepository = new RepositoryFileRepository();
