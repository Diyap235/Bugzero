import type { Pool } from 'pg';

import { getDatabasePool } from '../client/postgres.js';

export interface RepositoryCommit {
  id: string;
  organization_id: string;
  repository_id: string;
  commit_sha: string;
  parent_commit_sha: string | null;
  committed_at: string | null;
  indexed_at: string | null;
  created_at: string;
}

export interface CreateCommitInput {
  organizationId: string;
  repositoryId: string;
  commitSha: string;
  parentCommitSha?: string | null;
  committedAt?: string | null;
  indexedAt?: string | null;
}

export class CommitRepository {
  constructor(private readonly pool: Pool = getDatabasePool()) {}

  async getLatest(organizationId: string, repositoryId: string): Promise<RepositoryCommit | null> {
    const result = await this.pool.query<RepositoryCommit>(
      `SELECT *
       FROM repository_commits
       WHERE organization_id = $1 AND repository_id = $2
       ORDER BY committed_at DESC NULLS LAST, created_at DESC
       LIMIT 1`,
      [organizationId, repositoryId],
    );

    return result.rows[0] ?? null;
  }

  async getByCommitSha(organizationId: string, repositoryId: string, commitSha: string): Promise<RepositoryCommit | null> {
    const result = await this.pool.query<RepositoryCommit>(
      'SELECT * FROM repository_commits WHERE organization_id = $1 AND repository_id = $2 AND commit_sha = $3',
      [organizationId, repositoryId, commitSha],
    );

    return result.rows[0] ?? null;
  }

  async getById(organizationId: string, repositoryId: string, commitId: string): Promise<RepositoryCommit | null> {
    const result = await this.pool.query<RepositoryCommit>(
      'SELECT * FROM repository_commits WHERE organization_id = $1 AND repository_id = $2 AND id = $3',
      [organizationId, repositoryId, commitId],
    );
    return result.rows[0] ?? null;
  }

  async create(input: CreateCommitInput): Promise<RepositoryCommit> {
    const result = await this.pool.query<RepositoryCommit>(
      `INSERT INTO repository_commits (organization_id, repository_id, commit_sha, parent_commit_sha, committed_at, indexed_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        input.organizationId,
        input.repositoryId,
        input.commitSha,
        input.parentCommitSha ?? null,
        input.committedAt ?? null,
        input.indexedAt ?? null,
      ],
    );

    return result.rows[0];
  }

  async createOrGet(input: CreateCommitInput): Promise<RepositoryCommit> {
    const result = await this.pool.query<RepositoryCommit>(
      `INSERT INTO repository_commits (organization_id, repository_id, commit_sha, parent_commit_sha, committed_at, indexed_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (organization_id, repository_id, commit_sha)
       DO UPDATE SET parent_commit_sha = EXCLUDED.parent_commit_sha,
                     committed_at = EXCLUDED.committed_at,
                     indexed_at = COALESCE(repository_commits.indexed_at, EXCLUDED.indexed_at)
       RETURNING *`,
      [
        input.organizationId,
        input.repositoryId,
        input.commitSha,
        input.parentCommitSha ?? null,
        input.committedAt ?? null,
        input.indexedAt ?? null,
      ],
    );
    return result.rows[0];
  }
}

export const commitsRepository = new CommitRepository();
