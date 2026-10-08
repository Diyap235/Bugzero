import type { Pool } from 'pg';

import { getDatabasePool } from '../client/postgres.js';

export type MemberRole = 'OWNER' | 'ADMIN' | 'DEVELOPER' | 'SECURITY_REVIEWER' | 'VIEWER';

export interface MemberRecord {
  id: string;
  organization_id: string;
  user_id: string;
  role: MemberRole;
  created_at: string;
  updated_at: string;
}

export interface CreateMemberInput {
  organizationId: string;
  userId: string;
  role: MemberRole;
}

export class MemberRepository {
  constructor(private readonly pool: Pool = getDatabasePool()) {}

  async getMembership(organizationId: string, userId: string): Promise<MemberRecord | null> {
    const result = await this.pool.query<MemberRecord>(
      'SELECT * FROM members WHERE organization_id = $1 AND user_id = $2',
      [organizationId, userId],
    );

    return result.rows[0] ?? null;
  }

  async listByOrganization(organizationId: string): Promise<MemberRecord[]> {
    const result = await this.pool.query<MemberRecord>(
      'SELECT * FROM members WHERE organization_id = $1 ORDER BY created_at DESC',
      [organizationId],
    );

    return result.rows;
  }

  async create(input: CreateMemberInput): Promise<MemberRecord> {
    const result = await this.pool.query<MemberRecord>(
      `INSERT INTO members (organization_id, user_id, role)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [input.organizationId, input.userId, input.role],
    );

    return result.rows[0];
  }
}

export const membersRepository = new MemberRepository();
