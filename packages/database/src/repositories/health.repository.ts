import type { Pool } from 'pg';

import { getDatabasePool } from '../client/postgres.js';

export type HealthStatus = 'EXCELLENT' | 'GOOD' | 'FAIR' | 'POOR' | 'CRITICAL' | 'UNKNOWN' | 'PARTIAL';
export type HealthCoverage = 'COMPLETE' | 'PARTIAL' | 'UNKNOWN';

export interface HealthSnapshot {
  id: string;
  organization_id: string;
  repository_id: string;
  commit_id: string;
  analysis_run_id: string | null;
  profile_id: string | null;
  profile_version: number | null;
  model_version: string | null;
  overall_score: number | null;
  overall_status: HealthStatus | null;
  coverage: HealthCoverage | null;
  dimensions: Record<string, unknown> | null;
  profile_snapshot: Record<string, unknown> | null;
  calculation: Record<string, unknown> | null;
  explanation: string | null;
  security_score: number | null;
  quality_score: number | null;
  reliability_score: number | null;
  maintainability_score: number | null;
  dependency_score: number | null;
  created_at: string;
}

export interface CreateHealthSnapshotInput {
  organizationId: string;
  repositoryId: string;
  commitId: string;
  securityScore: number;
  qualityScore: number;
  reliabilityScore: number;
  maintainabilityScore: number;
  dependencyScore: number;
}

export interface CreateOrGetHealthSnapshotInput {
  organizationId: string;
  repositoryId: string;
  commitId: string;
  analysisRunId: string;
  profileId: string;
  profileVersion: number;
  modelVersion: string;
  overallScore: number | null;
  overallStatus: HealthStatus;
  coverage: HealthCoverage;
  dimensions: Record<string, unknown>;
  profileSnapshot: Record<string, unknown>;
  calculation: Record<string, unknown>;
  explanation: string;
  securityScore: number | null;
  qualityScore: number | null;
  reliabilityScore: number | null;
  maintainabilityScore: number | null;
  dependencyScore: number | null;
}

export interface CreateOrGetHealthSnapshotResult {
  record: HealthSnapshot;
  created: boolean;
}

function validateScore(name: string, score: number | null): void {
  if (score !== null && (!Number.isFinite(score) || score < 0 || score > 100)) {
    throw new Error(`${name} must be null or a finite number between 0 and 100`);
  }
}

function normalizeRecord(record: HealthSnapshot): HealthSnapshot {
  return {
    ...record,
    overall_score: record.overall_score === null ? null : Number(record.overall_score),
    security_score: record.security_score === null ? null : Number(record.security_score),
    quality_score: record.quality_score === null ? null : Number(record.quality_score),
    reliability_score: record.reliability_score === null ? null : Number(record.reliability_score),
    maintainability_score: record.maintainability_score === null ? null : Number(record.maintainability_score),
    dependency_score: record.dependency_score === null ? null : Number(record.dependency_score),
  };
}

export class HealthRepository {
  constructor(private readonly pool: Pool = getDatabasePool()) {}

  async createOrGetSnapshot(input: CreateOrGetHealthSnapshotInput): Promise<CreateOrGetHealthSnapshotResult> {
    validateScore('Overall health score', input.overallScore);
    validateScore('Security health score', input.securityScore);
    validateScore('Quality health score', input.qualityScore);
    validateScore('Reliability health score', input.reliabilityScore);
    validateScore('Maintainability health score', input.maintainabilityScore);
    validateScore('Dependency health score', input.dependencyScore);
    if (!input.profileId.trim() || !Number.isSafeInteger(input.profileVersion) || input.profileVersion < 1
      || !input.modelVersion.trim() || !input.explanation.trim()) {
      throw new Error('Health snapshot requires a valid profile identity and explanation');
    }

    const values = [
      input.organizationId,
      input.repositoryId,
      input.commitId,
      input.analysisRunId,
      input.securityScore,
      input.qualityScore,
      input.reliabilityScore,
      input.maintainabilityScore,
      input.dependencyScore,
      input.profileId,
      input.profileVersion,
      input.modelVersion,
      input.overallScore,
      input.overallStatus,
      input.coverage,
      input.dimensions,
      input.profileSnapshot,
      input.calculation,
      input.explanation,
    ];
    const inserted = await this.pool.query<HealthSnapshot>(
      `INSERT INTO health_snapshots (
        organization_id, repository_id, commit_id,
        analysis_run_id,
        security_score, quality_score, reliability_score, maintainability_score, dependency_score,
        profile_id, profile_version, model_version, overall_score, overall_status, coverage,
        dimensions, profile_snapshot, calculation, explanation
      )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
       ON CONFLICT (organization_id, repository_id, commit_id, profile_id, profile_version)
         WHERE profile_id IS NOT NULL
       DO NOTHING
       RETURNING *`,
      values,
    );
    if (inserted.rows[0]) return { record: normalizeRecord(inserted.rows[0]), created: true };

    const existing = await this.pool.query<HealthSnapshot>(
      `SELECT *
       FROM health_snapshots
       WHERE organization_id = $1 AND repository_id = $2 AND commit_id = $3
         AND profile_id = $4 AND profile_version = $5`,
      [input.organizationId, input.repositoryId, input.commitId, input.profileId, input.profileVersion],
    );
    if (!existing.rows[0]) throw new Error('Health snapshot identity conflict occurred but the existing snapshot could not be loaded');
    return { record: normalizeRecord(existing.rows[0]), created: false };
  }

  async createSnapshot(input: CreateHealthSnapshotInput): Promise<HealthSnapshot> {
    const scores = [
      input.securityScore,
      input.qualityScore,
      input.reliabilityScore,
      input.maintainabilityScore,
      input.dependencyScore,
    ];
    scores.forEach((score, index) => validateScore(`Legacy health dimension ${index + 1}`, score));
    const result = await this.pool.query<HealthSnapshot>(
      `INSERT INTO health_snapshots (
        organization_id, repository_id, commit_id, security_score, quality_score,
        reliability_score, maintainability_score, dependency_score
      )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        input.organizationId,
        input.repositoryId,
        input.commitId,
        input.securityScore,
        input.qualityScore,
        input.reliabilityScore,
        input.maintainabilityScore,
        input.dependencyScore,
      ],
    );
    const record = result.rows[0];
    if (!record) throw new Error('Health snapshot insert returned no record');
    return normalizeRecord(record);
  }

  async getLatest(organizationId: string, repositoryId: string): Promise<HealthSnapshot | null> {
    const result = await this.pool.query<HealthSnapshot>(
      `SELECT *
       FROM health_snapshots
       WHERE organization_id = $1 AND repository_id = $2
       ORDER BY created_at DESC
       LIMIT 1`,
      [organizationId, repositoryId],
    );

    return result.rows[0] ? normalizeRecord(result.rows[0]) : null;
  }

  async listByRepository(organizationId: string, repositoryId: string): Promise<HealthSnapshot[]> {
    const result = await this.pool.query<HealthSnapshot>(
      `SELECT *
       FROM health_snapshots
       WHERE organization_id = $1 AND repository_id = $2
       ORDER BY created_at DESC, id
       LIMIT 100`,
      [organizationId, repositoryId],
    );
    return result.rows.map(normalizeRecord);
  }
}

export const healthRepository = new HealthRepository();
