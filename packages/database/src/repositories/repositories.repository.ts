import type { Pool } from 'pg';

import { getDatabasePool } from '../client/postgres.js';
import { setTransactionOrganizationContext } from '../client/tenant-context.js';

export interface RepositoryRecord {
  id: string;
  organization_id: string;
  provider: 'GITHUB' | 'LOCAL';
  external_id: string;
  full_name: string;
  default_branch: string;
  clone_url: string;
  created_at: string;
  updated_at: string;
}

export interface CreateRepositoryInput {
  organizationId: string;
  provider: 'GITHUB' | 'LOCAL';
  externalId: string;
  fullName: string;
  defaultBranch: string;
  cloneUrl: string;
}

export interface CreateRepositoryWithCommitInput extends CreateRepositoryInput {
  commitSha: string;
  parentCommitSha?: string | null;
  committedAt?: string | null;
  indexedAt?: string | null;
}

export interface CreateRepositoryFileSnapshotInput {
  path: string;
  contentSha256: string;
  sizeBytes: number;
  language: string;
  sourceContent: string;
}

export interface CreateRepositoryWithCommitAndFilesInput extends CreateRepositoryWithCommitInput {
  files: CreateRepositoryFileSnapshotInput[];
}

export interface RepositoryWithCommit {
  repository: RepositoryRecord;
  commit: {
    id: string;
    organization_id: string;
    repository_id: string;
    commit_sha: string;
    parent_commit_sha: string | null;
    committed_at: string | null;
    indexed_at: string | null;
    created_at: string;
  };
}

export class RepositoryRepository {
  constructor(private readonly pool: Pool = getDatabasePool()) {}

  async getById(organizationId: string, repositoryId: string): Promise<RepositoryRecord | null> {
    const result = await this.pool.query<RepositoryRecord>(
      'SELECT * FROM repositories WHERE organization_id = $1 AND id = $2',
      [organizationId, repositoryId],
    );

    return result.rows[0] ?? null;
  }

  async listByOrganization(organizationId: string): Promise<RepositoryRecord[]> {
    const result = await this.pool.query<RepositoryRecord>(
      'SELECT * FROM repositories WHERE organization_id = $1 ORDER BY created_at DESC',
      [organizationId],
    );

    return result.rows;
  }

  async getByExternalId(organizationId: string, provider: 'GITHUB' | 'LOCAL', externalId: string): Promise<RepositoryRecord | null> {
    const result = await this.pool.query<RepositoryRecord>(
      'SELECT * FROM repositories WHERE organization_id = $1 AND provider = $2 AND external_id = $3',
      [organizationId, provider, externalId],
    );
    return result.rows[0] ?? null;
  }

  async create(input: CreateRepositoryInput): Promise<RepositoryRecord> {
    const result = await this.pool.query<RepositoryRecord>(
      `INSERT INTO repositories (organization_id, provider, external_id, full_name, default_branch, clone_url)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [input.organizationId, input.provider, input.externalId, input.fullName, input.defaultBranch, input.cloneUrl],
    );

    return result.rows[0];
  }

  async createOrUpdate(input: CreateRepositoryInput): Promise<RepositoryRecord> {
    const result = await this.pool.query<RepositoryRecord>(
      `INSERT INTO repositories (organization_id, provider, external_id, full_name, default_branch, clone_url)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (organization_id, provider, external_id)
       DO UPDATE SET full_name = EXCLUDED.full_name,
                     default_branch = EXCLUDED.default_branch,
                     clone_url = EXCLUDED.clone_url,
                     updated_at = now()
       RETURNING *`,
      [input.organizationId, input.provider, input.externalId, input.fullName, input.defaultBranch, input.cloneUrl],
    );
    return result.rows[0];
  }

  async createWithCommit(input: CreateRepositoryWithCommitInput): Promise<RepositoryWithCommit> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await setTransactionOrganizationContext(client);
      const repositoryResult = await client.query<RepositoryRecord>(
        `INSERT INTO repositories (organization_id, provider, external_id, full_name, default_branch, clone_url)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (organization_id, provider, external_id)
         DO UPDATE SET full_name = EXCLUDED.full_name,
                       default_branch = EXCLUDED.default_branch,
                       clone_url = EXCLUDED.clone_url,
                       updated_at = now()
         RETURNING *`,
        [input.organizationId, input.provider, input.externalId, input.fullName, input.defaultBranch, input.cloneUrl],
      );
      const repository = repositoryResult.rows[0];
      if (!repository) throw new Error('Repository registration returned no repository record');
      const commitResult = await client.query<RepositoryWithCommit['commit']>(
        `INSERT INTO repository_commits (organization_id, repository_id, commit_sha, parent_commit_sha, committed_at, indexed_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (organization_id, repository_id, commit_sha)
         DO UPDATE SET parent_commit_sha = EXCLUDED.parent_commit_sha,
                       committed_at = EXCLUDED.committed_at,
                       indexed_at = COALESCE(repository_commits.indexed_at, EXCLUDED.indexed_at)
         RETURNING *`,
        [
          input.organizationId,
          repository.id,
          input.commitSha,
          input.parentCommitSha ?? null,
          input.committedAt ?? null,
          input.indexedAt ?? null,
        ],
      );
      const commit = commitResult.rows[0];
      if (!commit) throw new Error('Repository registration returned no commit record');
      await client.query('COMMIT');
      return { repository, commit };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async createWithCommitAndFiles(input: CreateRepositoryWithCommitAndFilesInput): Promise<RepositoryWithCommit> {
      const client = await this.pool.connect();
      try {
        await client.query('BEGIN');
        await setTransactionOrganizationContext(client);
        const repositoryResult = await client.query<RepositoryRecord>(
          `INSERT INTO repositories (organization_id, provider, external_id, full_name, default_branch, clone_url)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (organization_id, provider, external_id)
           DO UPDATE SET full_name = EXCLUDED.full_name,
                         default_branch = EXCLUDED.default_branch,
                         clone_url = EXCLUDED.clone_url,
                         updated_at = now()
           RETURNING *`,
          [input.organizationId, input.provider, input.externalId, input.fullName, input.defaultBranch, input.cloneUrl],
        );
        const repository = repositoryResult.rows[0];
        if (!repository) throw new Error('Repository registration returned no repository record');
        const commitResult = await client.query<RepositoryWithCommit['commit']>(
          `INSERT INTO repository_commits (organization_id, repository_id, commit_sha, parent_commit_sha, committed_at, indexed_at)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (organization_id, repository_id, commit_sha)
           DO UPDATE SET parent_commit_sha = EXCLUDED.parent_commit_sha,
                         committed_at = EXCLUDED.committed_at,
                         indexed_at = COALESCE(repository_commits.indexed_at, EXCLUDED.indexed_at)
           RETURNING *`,
          [
            input.organizationId,
            repository.id,
            input.commitSha,
            input.parentCommitSha ?? null,
            input.committedAt ?? null,
            input.indexedAt ?? null,
          ],
        );
        const commit = commitResult.rows[0];
        if (!commit) throw new Error('Repository registration returned no commit record');

        for (let offset = 0; offset < input.files.length; offset += 200) {
          const batch = input.files.slice(offset, offset + 200);
          const values: unknown[] = [];
          const placeholders = batch.map((file, index) => {
            const parameter = index * 9;
            values.push(
              input.organizationId,
              repository.id,
              commit.id,
              file.path,
              file.contentSha256,
              file.sizeBytes,
              file.language,
              null,
              file.sourceContent,
            );
            return `(${Array.from({ length: 9 }, (_, column) => `$${parameter + column + 1}`).join(', ')})`;
          });
          await client.query(
            `INSERT INTO repository_files
               (organization_id, repository_id, commit_id, path, content_sha256, size_bytes, language, object_key, source_content)
             VALUES ${placeholders.join(', ')}
             ON CONFLICT (organization_id, commit_id, path)
             DO UPDATE SET content_sha256 = EXCLUDED.content_sha256,
                           size_bytes = EXCLUDED.size_bytes,
                           language = EXCLUDED.language,
                           source_content = EXCLUDED.source_content`,
            values,
          );
        }
        await client.query('COMMIT');
        return { repository, commit };
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally {
        client.release();
    }
  }
}

export const repositoriesRepository = new RepositoryRepository();
