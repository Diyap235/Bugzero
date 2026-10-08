import type { Pool } from 'pg';

import { getDatabasePool } from '../client/postgres.js';

export interface AuditLog {
  id: string;
  organization_id: string;
  actor_user_id: string | null;
  action: string;
  subject_type: string;
  subject_id: string | null;
  previous_state: Record<string, unknown> | null;
  new_state: Record<string, unknown> | null;
  reason: string | null;
  created_at: string;
}

export interface CreateAuditLogInput {
  organizationId: string;
  actorUserId?: string | null;
  action: string;
  subjectType: string;
  subjectId?: string | null;
  previousState?: Record<string, unknown> | null;
  newState?: Record<string, unknown> | null;
  reason?: string | null;
}

export class AuditRepository {
  constructor(private readonly pool: Pool = getDatabasePool()) {}

  async createLog(input: CreateAuditLogInput): Promise<AuditLog> {
    const result = await this.pool.query<AuditLog>(
      `INSERT INTO audit_logs (organization_id, actor_user_id, action, subject_type, subject_id, previous_state, new_state, reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        input.organizationId,
        input.actorUserId ?? null,
        input.action,
        input.subjectType,
        input.subjectId ?? null,
        input.previousState ?? null,
        input.newState ?? null,
        input.reason ?? null,
      ],
    );

    return result.rows[0];
  }

  async listByOrganization(organizationId: string): Promise<AuditLog[]> {
    const result = await this.pool.query<AuditLog>(
      'SELECT * FROM audit_logs WHERE organization_id = $1 ORDER BY created_at DESC',
      [organizationId],
    );

    return result.rows;
  }
}

export const auditRepository = new AuditRepository();
