import type { Pool } from 'pg';

import { getDatabasePool } from '../client/postgres.js';
import { setTransactionOrganizationContext } from '../client/tenant-context.js';

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
    if (!result.rows[0]) throw new Error('Report insert returned no record');
    return result.rows[0];
  }

  async createOrGetReport(input: CreateReportInput): Promise<{ record: ReportRecord; created: boolean }> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await setTransactionOrganizationContext(client);
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
        `${input.organizationId}:${input.repositoryId}:${input.analysisRunId}:${input.format}`,
      ]);
      const existing = await client.query<ReportRecord>(
        `SELECT * FROM reports
         WHERE organization_id = $1 AND repository_id = $2 AND analysis_run_id = $3 AND format = $4
         ORDER BY created_at DESC, id
         LIMIT 1`,
        [input.organizationId, input.repositoryId, input.analysisRunId, input.format],
      );
      if (existing.rows[0]) {
        await client.query('COMMIT');
        return { record: existing.rows[0], created: false };
      }
      const result = await client.query<ReportRecord>(
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
      if (!result.rows[0]) throw new Error('Report insert returned no record');
      await client.query('COMMIT');
      return { record: result.rows[0], created: true };
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        throw new AggregateError([error, rollbackError], 'Report persistence and rollback failed');
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async getById(organizationId: string, reportId: string): Promise<ReportRecord | null> {
    const result = await this.pool.query<ReportRecord>(
      'SELECT * FROM reports WHERE organization_id = $1 AND id = $2',
      [organizationId, reportId],
    );
    return result.rows[0] ?? null;
  }

  async saveDocument(organizationId: string, reportId: string, document: Record<string, unknown>): Promise<ReportRecord> {
    const result = await this.pool.query<ReportRecord>(
      `UPDATE reports
       SET metadata = jsonb_set(metadata, '{report}', $3::jsonb, true)
       WHERE organization_id = $1 AND id = $2
       RETURNING *`,
      [organizationId, reportId, JSON.stringify(document)],
    );
    if (!result.rows[0]) throw new Error('Report document could not be persisted');
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
