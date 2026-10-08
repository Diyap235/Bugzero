import type { Pool } from 'pg';
import { defaultAnalysisProfile } from '@bugzero/config';

import { getDatabasePool } from '../client/postgres.js';
import { setTransactionOrganizationContext } from '../client/tenant-context.js';

export type AnalysisScope = 'REPOSITORY' | 'COMMIT' | 'CHANGED_FILES' | 'AFFECTED_SYMBOLS' | 'PR';
export type AnalysisRunStatus = 'NOT_STARTED' | 'RUNNING' | 'COMPLETED' | 'PARTIAL' | 'FAILED' | 'UNAVAILABLE';
export type AnalysisJobStage = 'INGESTION' | 'PARSING' | 'CODE_IR' | 'INTELLIGENCE' | 'SECURITY_ANALYSIS' | 'QUALITY_ANALYSIS' | 'DEPENDENCY_ANALYSIS' | 'EVIDENCE' | 'RISK' | 'AI_ENRICHMENT';
export type AnalysisJobStatus = 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'RETRY' | 'DEAD_LETTER' | 'CANCELLED';
export type AnalysisJobType = 'STRUCTURAL' | 'SECURITY' | 'TAINT' | 'DEPENDENCY' | 'QUALITY';

export interface AnalysisProfile {
  id: string;
  organization_id: string;
  version: string;
  analyzers: unknown[];
  max_depth: number | null;
  created_at: string;
}

export interface AnalysisRun {
  id: string;
  organization_id: string;
  repository_id: string;
  commit_id: string;
  profile_id: string;
  profile_version: string;
  scope: AnalysisScope;
  status: AnalysisRunStatus;
  coverage: Record<string, unknown>;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

export interface AnalysisJob {
  id: string;
  organization_id: string;
  run_id: string;
  stage: AnalysisJobStage;
  analyzer: string;
  analyzer_type: AnalysisJobType;
  scope_key: string;
  status: AnalysisJobStatus;
  attempt: number;
  idempotency_key: string;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface CreateAnalysisProfileInput {
  organizationId: string;
  id: string;
  version: string;
  analyzers: unknown[];
  maxDepth?: number | null;
}

export interface CreateAnalysisRunInput {
  organizationId: string;
  repositoryId: string;
  commitId: string;
  profileId: string;
  profileVersion: string;
  scope: AnalysisScope;
  status: AnalysisRunStatus;
  coverage?: Record<string, unknown>;
}

export interface CreateAnalysisJobInput {
  organizationId: string;
  runId: string;
  stage: AnalysisJobStage;
  analyzer: string;
  analyzerType: AnalysisJobType;
  scopeKey: string;
  status: AnalysisJobStatus;
  attempt?: number;
  idempotencyKey: string;
}

export interface CreateAnalysisWorkInput {
  organizationId: string;
  repositoryId: string;
  commitId: string;
  profileId: string;
  profileVersion: string;
  scope: AnalysisScope;
  analyzer: string;
  analyzerType: AnalysisJobType;
  scopeKey: string;
  idempotencyKey: string;
}

export interface CreatedAnalysisWork {
  run: AnalysisRun;
  job: AnalysisJob;
  created: boolean;
}

export class AnalysisRepository {
  constructor(private readonly pool: Pool = getDatabasePool()) {}

  async createProfile(input: CreateAnalysisProfileInput): Promise<AnalysisProfile> {
    const result = await this.pool.query<AnalysisProfile>(
      `INSERT INTO analysis_profiles (id, organization_id, version, analyzers, max_depth)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [input.id, input.organizationId, input.version, JSON.stringify(input.analyzers), input.maxDepth ?? null],
    );

    return result.rows[0];
  }

  async getProfile(organizationId: string, profileId: string, version: string): Promise<AnalysisProfile | null> {
    const result = await this.pool.query<AnalysisProfile>(
      'SELECT * FROM analysis_profiles WHERE organization_id = $1 AND id = $2 AND version = $3',
      [organizationId, profileId, version],
    );

    return result.rows[0] ?? null;
  }

  async getLatestProfile(organizationId: string, profileId: string): Promise<AnalysisProfile | null> {
    const result = await this.pool.query<AnalysisProfile>(
      `SELECT * FROM analysis_profiles
       WHERE organization_id = $1 AND id = $2
       ORDER BY created_at DESC, version DESC
       LIMIT 1`,
      [organizationId, profileId],
    );
    return result.rows[0] ?? null;
  }

  async ensureDefaultProfile(organizationId: string): Promise<AnalysisProfile> {
    const configured = await this.getLatestProfile(organizationId, defaultAnalysisProfile.id);
    if (configured) return configured;

    const result = await this.pool.query<AnalysisProfile>(
      `INSERT INTO analysis_profiles (id, organization_id, version, analyzers, max_depth)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (organization_id, id, version) DO NOTHING
       RETURNING *`,
      [
        defaultAnalysisProfile.id,
        organizationId,
        defaultAnalysisProfile.version,
        JSON.stringify(defaultAnalysisProfile.analyzers),
        defaultAnalysisProfile.maxDepth,
      ],
    );
    if (result.rows[0]) return result.rows[0];

    const existing = await this.getLatestProfile(organizationId, defaultAnalysisProfile.id);
    if (!existing) throw new Error(`Default analysis profile is unavailable for organization ${organizationId}`);
    return existing;
  }

  async createRun(input: CreateAnalysisRunInput): Promise<AnalysisRun> {
    const result = await this.pool.query<AnalysisRun>(
      `INSERT INTO analysis_runs (organization_id, repository_id, commit_id, profile_id, profile_version, scope, status, coverage)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        input.organizationId,
        input.repositoryId,
        input.commitId,
        input.profileId,
        input.profileVersion,
        input.scope,
        input.status,
        input.coverage ?? {},
      ],
    );

    return result.rows[0];
  }

  async getRun(organizationId: string, runId: string): Promise<AnalysisRun | null> {
    const result = await this.pool.query<AnalysisRun>(
      'SELECT * FROM analysis_runs WHERE organization_id = $1 AND id = $2',
      [organizationId, runId],
    );

    return result.rows[0] ?? null;
  }

  async listRunsByRepository(organizationId: string, repositoryId: string): Promise<AnalysisRun[]> {
    const result = await this.pool.query<AnalysisRun>(
      'SELECT * FROM analysis_runs WHERE organization_id = $1 AND repository_id = $2 ORDER BY created_at DESC',
      [organizationId, repositoryId],
    );

    return result.rows;
  }

  async createJob(input: CreateAnalysisJobInput): Promise<AnalysisJob> {
    const result = await this.pool.query<AnalysisJob>(
      `INSERT INTO analysis_jobs (organization_id, run_id, stage, analyzer, analyzer_type, scope_key, status, attempt, idempotency_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        input.organizationId,
        input.runId,
        input.stage,
        input.analyzer,
        input.analyzerType,
        input.scopeKey,
        input.status,
        input.attempt ?? 0,
        input.idempotencyKey,
      ],
    );

    return result.rows[0];
  }

  async createOrGetActiveWork(input: CreateAnalysisWorkInput): Promise<CreatedAnalysisWork> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await setTransactionOrganizationContext(client);
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
        `${input.organizationId}:${input.idempotencyKey}`,
      ]);

      const existingJobResult = await client.query<AnalysisJob>(
        `SELECT * FROM analysis_jobs
         WHERE organization_id = $1
           AND (idempotency_key = $2 OR idempotency_key LIKE $2 || ':%')
           AND status IN ('QUEUED', 'RUNNING', 'RETRY')
         LIMIT 1
         FOR UPDATE`,
        [input.organizationId, input.idempotencyKey],
      );
      const existingJob = existingJobResult.rows[0];
      if (existingJob) {
        const existingRunResult = await client.query<AnalysisRun>(
          'SELECT * FROM analysis_runs WHERE organization_id = $1 AND id = $2',
          [input.organizationId, existingJob.run_id],
        );
        const existingRun = existingRunResult.rows[0];
        if (!existingRun) throw new Error(`Analysis run ${existingJob.run_id} was not found`);
        await client.query('COMMIT');
        return { run: existingRun, job: existingJob, created: false };
      }

      const runResult = await client.query<AnalysisRun>(
        `INSERT INTO analysis_runs (
           organization_id, repository_id, commit_id, profile_id, profile_version, scope, status, coverage
         )
         VALUES ($1, $2, $3, $4, $5, $6, 'NOT_STARTED', '{}'::jsonb)
         RETURNING *`,
        [
          input.organizationId,
          input.repositoryId,
          input.commitId,
          input.profileId,
          input.profileVersion,
          input.scope,
        ],
      );
      const run = runResult.rows[0];
      if (!run) throw new Error('Analysis run creation returned no row');

      const jobResult = await client.query<AnalysisJob>(
        `INSERT INTO analysis_jobs (
           organization_id, run_id, stage, analyzer, analyzer_type, scope_key, status, attempt, idempotency_key
         )
         VALUES ($1, $2, 'PARSING', $3, $4, $5, 'QUEUED', 0, $6)
         RETURNING *`,
        [
          input.organizationId,
          run.id,
          input.analyzer,
          input.analyzerType,
          input.scopeKey,
          `${input.idempotencyKey}:${run.id}`,
        ],
      );
      const job = jobResult.rows[0];
      if (!job) throw new Error('Analysis job creation returned no row');
      await client.query('COMMIT');
      return { run, job, created: true };
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        throw new AggregateError([error, rollbackError], 'Analysis work creation and rollback failed');
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async getJob(organizationId: string, jobId: string): Promise<AnalysisJob | null> {
    const result = await this.pool.query<AnalysisJob>(
      'SELECT * FROM analysis_jobs WHERE organization_id = $1 AND id = $2',
      [organizationId, jobId],
    );

    return result.rows[0] ?? null;
  }

  async getLatestJobForRun(organizationId: string, runId: string): Promise<AnalysisJob | null> {
    const result = await this.pool.query<AnalysisJob>(
      `SELECT * FROM analysis_jobs
       WHERE organization_id = $1 AND run_id = $2
       ORDER BY created_at DESC
       LIMIT 1`,
      [organizationId, runId],
    );
    return result.rows[0] ?? null;
  }

  async updateJobStatus(
    organizationId: string,
    jobId: string,
    status: AnalysisJobStatus,
    attempt?: number,
  ): Promise<AnalysisJob> {
    const result = await this.pool.query<AnalysisJob>(
      `UPDATE analysis_jobs
       SET status = $3,
           attempt = GREATEST(attempt, COALESCE($4, attempt)),
           started_at = CASE WHEN $3 = 'RUNNING' THEN COALESCE(started_at, now()) ELSE started_at END,
           finished_at = CASE WHEN $3 IN ('COMPLETED', 'FAILED', 'DEAD_LETTER', 'CANCELLED') THEN now() ELSE NULL END
       WHERE organization_id = $1 AND id = $2
       RETURNING *`,
      [organizationId, jobId, status, attempt ?? null],
    );
    if (!result.rows[0]) throw new Error(`Analysis job ${jobId} was not found`);
    return result.rows[0];
  }

  async updateJobStage(organizationId: string, jobId: string, stage: AnalysisJobStage): Promise<AnalysisJob> {
    const result = await this.pool.query<AnalysisJob>(
      `UPDATE analysis_jobs SET stage = $3 WHERE organization_id = $1 AND id = $2 RETURNING *`,
      [organizationId, jobId, stage],
    );
    if (!result.rows[0]) throw new Error(`Analysis job ${jobId} was not found`);
    return result.rows[0];
  }

  async updateRunStatus(
    organizationId: string,
    runId: string,
    status: AnalysisRunStatus,
    coverage: Record<string, unknown>,
  ): Promise<AnalysisRun> {
    const result = await this.pool.query<AnalysisRun>(
      `UPDATE analysis_runs
       SET status = $3,
           coverage = $4,
           started_at = CASE WHEN $3 = 'RUNNING' THEN COALESCE(started_at, now()) ELSE started_at END,
           completed_at = CASE WHEN $3 IN ('COMPLETED', 'PARTIAL', 'FAILED', 'UNAVAILABLE') THEN now() ELSE NULL END
       WHERE organization_id = $1 AND id = $2
       RETURNING *`,
      [organizationId, runId, status, coverage],
    );
    if (!result.rows[0]) throw new Error(`Analysis run ${runId} was not found`);
    return result.rows[0];
  }
}

export const analysisRepository = new AnalysisRepository();
