import type { Pool } from 'pg';

import { getDatabasePool } from '../client/postgres.js';

export interface CreateAccountWorkspaceInput {
  userId: string;
  organizationId: string;
  email: string;
  displayName: string;
  passwordHash: string;
  workspaceName: string;
  workspaceSlug: string;
}

export interface AuthAccountRecord {
  id: string;
  email: string;
  display_name: string | null;
  password_hash: string | null;
  default_organization_id: string | null;
}

export interface AuthenticatedSessionRecord {
  user_id: string;
  email: string;
  display_name: string;
  organization_id: string;
  organization_name: string;
  role: string;
}

export class AuthRepository {
  constructor(private readonly pool: Pool = getDatabasePool()) {}

  async createAccountWorkspace(input: CreateAccountWorkspaceInput): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.organization_id', $1, true)", [input.organizationId]);
      await client.query(
        `INSERT INTO organizations (id, name, slug)
         VALUES ($1, $2, $3)`,
        [input.organizationId, input.workspaceName, input.workspaceSlug],
      );
      await client.query(
        `INSERT INTO users (id, email, display_name, password_hash, default_organization_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [input.userId, input.email, input.displayName, input.passwordHash, input.organizationId],
      );
      await client.query(
        `INSERT INTO members (organization_id, user_id, role)
         VALUES ($1, $2, 'OWNER')`,
        [input.organizationId, input.userId],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async getAccountByEmail(email: string): Promise<AuthAccountRecord | null> {
    const result = await this.pool.query<AuthAccountRecord>(
      `SELECT id, email, display_name, password_hash, default_organization_id
       FROM users
       WHERE lower(email) = $1`,
      [email],
    );
    return result.rows[0] ?? null;
  }

  async getSessionContext(userId: string, organizationId: string): Promise<AuthenticatedSessionRecord | null> {
    const result = await this.pool.query<AuthenticatedSessionRecord>(
      `SELECT u.id AS user_id, u.email, COALESCE(NULLIF(u.display_name, ''), u.email) AS display_name,
              o.id AS organization_id, o.name AS organization_name, m.role
       FROM users u
       INNER JOIN members m ON m.user_id = u.id
       INNER JOIN organizations o ON o.id = m.organization_id
       WHERE u.id = $1 AND o.id = $2`,
      [userId, organizationId],
    );
    return result.rows[0] ?? null;
  }
}

export const authRepository = new AuthRepository();
