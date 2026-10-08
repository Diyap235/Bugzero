import type { Pool } from 'pg';

import { getDatabasePool } from '../client/postgres.js';

export interface Organization {
  id: string;
  name: string;
  slug: string;
  created_at: string;
  updated_at: string;
}

export interface CreateOrganizationInput {
  name: string;
  slug: string;
}

export class OrganizationRepository {
  constructor(private readonly pool: Pool = getDatabasePool()) {}

  async getById(organizationId: string): Promise<Organization | null> {
    const result = await this.pool.query<Organization>(
      'SELECT * FROM organizations WHERE id = $1',
      [organizationId],
    );

    return result.rows[0] ?? null;
  }

  async listByUser(userId: string): Promise<Organization[]> {
    const result = await this.pool.query<Organization>(
      `SELECT o.*
       FROM organizations o
       INNER JOIN members m ON m.organization_id = o.id
       WHERE m.user_id = $1
       ORDER BY o.created_at DESC`,
      [userId],
    );

    return result.rows;
  }

  async create(input: CreateOrganizationInput): Promise<Organization> {
    const result = await this.pool.query<Organization>(
      `INSERT INTO organizations (name, slug)
       VALUES ($1, $2)
       RETURNING *`,
      [input.name, input.slug],
    );

    return result.rows[0];
  }
}

export const organizationsRepository = new OrganizationRepository();
