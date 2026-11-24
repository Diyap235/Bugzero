import type { Pool } from 'pg';
import type {
  OrganizationInvitation,
  OrganizationInvitationRole,
} from '@bugzero/contracts';

import { getDatabasePool } from '../client/postgres.js';
import { getOrganizationContext } from '../client/tenant-context.js';

interface InvitationRow {
  id: string;
  organizationId: string;
  email: string;
  role: OrganizationInvitationRole;
  status: OrganizationInvitation['status'];
  expiresAt: Date | string;
  createdAt: Date | string;
  acceptedAt: Date | string | null;
}

interface CreateInvitationInput {
  id: string;
  organizationId: string;
  email: string;
  role: OrganizationInvitationRole;
  tokenHash: string;
  createdBy: string;
}

export type AcceptInvitationResult =
  | { status: 'ACCEPTED'; email: string; role: OrganizationInvitationRole }
  | { status: 'ALREADY_MEMBER'; email: string; role: string }
  | { status: 'EXPIRED' }
  | { status: 'USED' }
  | { status: 'EMAIL_MISMATCH' }
  | { status: 'INVALID' };

export class InvitationRepositoryError extends Error {
  constructor(readonly code: 'FORBIDDEN' | 'ALREADY_MEMBER' | 'ALREADY_PENDING') {
    super(code);
    this.name = 'InvitationRepositoryError';
  }
}

function isoDate(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapInvitation(row: InvitationRow): OrganizationInvitation {
  return {
    id: row.id,
    organizationId: row.organizationId,
    email: row.email,
    role: row.role,
    status: row.status,
    expiresAt: isoDate(row.expiresAt)!,
    createdAt: isoDate(row.createdAt)!,
    acceptedAt: isoDate(row.acceptedAt),
  };
}

function requireOrganizationContext(organizationId: string): void {
  if (getOrganizationContext() !== organizationId) {
    throw new Error('Organization invitation access requires the matching authenticated tenant context');
  }
}

export class OrganizationInvitationRepository {
  constructor(private readonly pool: Pool = getDatabasePool()) {}

  async create(input: CreateInvitationInput): Promise<OrganizationInvitation> {
    requireOrganizationContext(input.organizationId);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.organization_id', $1, true)", [input.organizationId]);

      const inviter = await client.query<{ role: string }>(
        `SELECT role
         FROM members
         WHERE organization_id = $1 AND user_id = $2
         FOR SHARE`,
        [input.organizationId, input.createdBy],
      );
      if (!['OWNER', 'ADMIN'].includes(inviter.rows[0]?.role ?? '')) {
        throw new InvitationRepositoryError('FORBIDDEN');
      }

      const existingMember = await client.query(
        `SELECT 1
         FROM members m
         INNER JOIN users u ON u.id = m.user_id
         WHERE m.organization_id = $1 AND lower(u.email) = $2`,
        [input.organizationId, input.email],
      );
      if (existingMember.rowCount) throw new InvitationRepositoryError('ALREADY_MEMBER');

      await client.query(
        `UPDATE organization_invitations
         SET status = 'EXPIRED'
         WHERE organization_id = $1 AND email = $2
           AND status = 'PENDING' AND expires_at <= now()`,
        [input.organizationId, input.email],
      );

      const result = await client.query<InvitationRow>(
        `INSERT INTO organization_invitations (
           id, organization_id, email, role, token_hash, expires_at, created_by
         )
         VALUES ($1, $2, $3, $4, $5, now() + interval '7 days', $6)
         RETURNING id, organization_id AS "organizationId", email, role, status,
                   expires_at AS "expiresAt", created_at AS "createdAt",
                   accepted_at AS "acceptedAt"`,
        [input.id, input.organizationId, input.email, input.role, input.tokenHash, input.createdBy],
      );
      const row = result.rows[0];
      if (!row) throw new Error('Invitation insert returned no row');

      await client.query('COMMIT');
      return mapInvitation(row);
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        throw new AggregateError([error, rollbackError], 'Invitation creation failed and rollback did not complete');
      }
      if (
        typeof error === 'object'
        && error !== null
        && 'constraint' in error
        && error.constraint === 'organization_invitations_pending_email_unique'
      ) {
        throw new InvitationRepositoryError('ALREADY_PENDING');
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async list(organizationId: string): Promise<OrganizationInvitation[]> {
    requireOrganizationContext(organizationId);
    const result = await this.pool.query<InvitationRow>(
      `SELECT id, organization_id AS "organizationId", email, role,
              CASE WHEN status = 'PENDING' AND expires_at <= now() THEN 'EXPIRED' ELSE status END AS status,
              expires_at AS "expiresAt", created_at AS "createdAt", accepted_at AS "acceptedAt"
       FROM organization_invitations
       WHERE organization_id = $1
       ORDER BY created_at DESC`,
      [organizationId],
    );
    return result.rows.map(mapInvitation);
  }

  async accept(input: {
    organizationId: string;
    userId: string;
    tokenHash: string;
  }): Promise<AcceptInvitationResult> {
    requireOrganizationContext(input.organizationId);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.organization_id', $1, true)", [input.organizationId]);

      const invitationResult = await client.query<{
        id: string;
        email: string;
        role: OrganizationInvitationRole;
        status: OrganizationInvitation['status'];
        isExpired: boolean;
      }>(
        `SELECT id, email, role, status, expires_at <= now() AS "isExpired"
         FROM organization_invitations
         WHERE organization_id = $1 AND token_hash = $2
         FOR UPDATE`,
        [input.organizationId, input.tokenHash],
      );
      const invitation = invitationResult.rows[0];
      if (!invitation) {
        await client.query('COMMIT');
        return { status: 'INVALID' };
      }
      if (invitation.status === 'EXPIRED') {
        await client.query('COMMIT');
        return { status: 'EXPIRED' };
      }
      if (invitation.status !== 'PENDING') {
        await client.query('COMMIT');
        return { status: 'USED' };
      }
      if (invitation.isExpired) {
        await client.query(
          `UPDATE organization_invitations SET status = 'EXPIRED'
           WHERE id = $1 AND organization_id = $2 AND status = 'PENDING'`,
          [invitation.id, input.organizationId],
        );
        await client.query('COMMIT');
        return { status: 'EXPIRED' };
      }

      const accountResult = await client.query<{ email: string }>(
        'SELECT lower(email) AS email FROM users WHERE id = $1 FOR UPDATE',
        [input.userId],
      );
      const email = accountResult.rows[0]?.email;
      if (!email || email !== invitation.email) {
        await client.query('COMMIT');
        return { status: 'EMAIL_MISMATCH' };
      }

      const existingMember = await client.query<{ role: string }>(
        'SELECT role FROM members WHERE organization_id = $1 AND user_id = $2 FOR UPDATE',
        [input.organizationId, input.userId],
      );
      const role = existingMember.rows[0]?.role;
      if (role) {
        await client.query(
          `UPDATE organization_invitations
           SET status = 'ACCEPTED', accepted_by = $1, accepted_at = now()
           WHERE id = $2 AND organization_id = $3 AND status = 'PENDING'`,
          [input.userId, invitation.id, input.organizationId],
        );
        await client.query(
          'UPDATE users SET default_organization_id = $1 WHERE id = $2',
          [input.organizationId, input.userId],
        );
        await client.query('COMMIT');
        return { status: 'ALREADY_MEMBER', email, role };
      }

      await client.query(
        `INSERT INTO members (organization_id, user_id, role)
         VALUES ($1, $2, $3)`,
        [input.organizationId, input.userId, invitation.role],
      );
      await client.query(
        `UPDATE organization_invitations
         SET status = 'ACCEPTED', accepted_by = $1, accepted_at = now()
         WHERE id = $2 AND organization_id = $3 AND status = 'PENDING'`,
        [input.userId, invitation.id, input.organizationId],
      );
      await client.query(
        'UPDATE users SET default_organization_id = $1 WHERE id = $2',
        [input.organizationId, input.userId],
      );
      await client.query('COMMIT');
      return { status: 'ACCEPTED', email, role: invitation.role };
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        throw new AggregateError([error, rollbackError], 'Invitation acceptance failed and rollback did not complete');
      }
      throw error;
    } finally {
      client.release();
    }
  }
}

export const organizationInvitationRepository = new OrganizationInvitationRepository();
