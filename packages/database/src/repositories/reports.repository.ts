import type { Pool } from 'pg';

import { getDatabasePool } from '../client/postgres.js';

export interface ReportRecord {
  id: string;
  organization_id: string;
  repository_id: string;
  analysis_run_id: string;
  created_by_user_id: string | null;
  format: 'JSON' | 'PDF' | 'HTML';
  object_key: string | null;
  metadata: Record<string, unknown>;
  created_at: string | Date;
}

export interface CreateReportInput {
  organizationId: string;
  repositoryId: string;
  analysisRunId: string;
  createdByUserId?: string | null;
  format: 'JSON' | 'PDF' | 'HTML';
  objectKey?: string | null;
  metadata?: Record<string, unknown>;
}

export class ReportRepository {
  constructor(private readonly pool: Pool = getDatabasePool()) {}

  async createReport(input: CreateReportInput): Promise<ReportRecord> {
    const result = await this.pool.query<ReportRecord>(
      `INSERT INTO reports (organization_id, repository_id, analysis_run_id, created_by_user_id, format, object_key, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        input.organizationId,
        input.repositoryId,
        input.analysisRunId,
        input.createdByUserId ?? null,
        input.format,
        input.objectKey ?? null,
        input.metadata ?? {},
      ],
    );

    return result.rows[0];
  }

  async listByRepository(organizationId: string, repositoryId: string): Promise<ReportRecord[]> {
    const result = await this.pool.query<ReportRecord>(
      'SELECT * FROM reports WHERE organization_id = $1 AND repository_id = $2 ORDER BY created_at DESC',
      [organizationId, repositoryId],
    );

    return result.rows;
  }
}

export const reportsRepository = new ReportRepository();
