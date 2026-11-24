import assert from 'node:assert/strict';
import test from 'node:test';
import type { Pool, PoolClient } from 'pg';
import { withOrganizationContext } from '../src/client/tenant-context.js';
import { InvitationRepositoryError, OrganizationInvitationRepository } from '../src/repositories/organization-invitations.repository.js';

const userId = '33333333-3333-4333-8333-333333333333';
const organizationId = '11111111-1111-4111-8111-111111111111';
const otherOrganizationId = '22222222-2222-4222-8222-222222222222';
const invitationId = '44444444-4444-4444-8444-444444444444';
const tokenHash = 'a'.repeat(64);

interface QueryCall {
  sql: string;
  values: unknown[];
}

interface QueryResponse {
  rows: unknown[];
  rowCount?: number;
}

function fakeRepository(
  respond: (sql: string, values: unknown[]) => QueryResponse = () => ({ rows: [] }),
) {
  const calls: QueryCall[] = [];
  const query = async (sql: string, values: unknown[] = []) => {
    calls.push({ sql, values });
    const response = respond(sql, values);
    return {
      rows: response.rows,
      rowCount: response.rowCount ?? response.rows.length,
    };
  };
  const client = {
    query,
    release() {},
  } as unknown as PoolClient;
  const pool = {
    connect: async () => client,
    query,
  } as unknown as Pool;
  return { repository: new OrganizationInvitationRepository(pool), calls };
}

function inTenant<T>(operation: () => Promise<T>): Promise<T> {
  return withOrganizationContext(organizationId, operation);
}

test('invitation creation verifies an OWNER/ADMIN in-transaction and scopes the insert to that organization', async () => {
  const { repository, calls } = fakeRepository((sql) => {
    if (sql.includes('SELECT role') && sql.includes('FOR SHARE')) return { rows: [{ role: 'OWNER' }] };
    if (sql.includes('INNER JOIN users')) return { rows: [] };
    if (sql.includes('INSERT INTO organization_invitations')) {
      return {
        rows: [{
          id: invitationId,
          organizationId,
          email: 'invitee@example.com',
          role: 'DEVELOPER',
          status: 'PENDING',
          expiresAt: new Date('2026-11-21T00:00:00.000Z'),
          createdAt: new Date('2026-11-14T00:00:00.000Z'),
          acceptedAt: null,
        }],
      };
    }
    return { rows: [] };
  });

  const result = await inTenant(() => repository.create({
    id: invitationId,
    organizationId,
    email: 'invitee@example.com',
    role: 'DEVELOPER',
    tokenHash,
    createdBy: userId,
  }));

  assert.equal(result.organizationId, organizationId);
  assert.equal(result.email, 'invitee@example.com');
  assert.ok(calls.some((call) => call.sql.includes("set_config('app.organization_id'") && call.values[0] === organizationId));
  assert.ok(calls.some((call) => call.sql.includes('now() + interval \'7 days\'')));
  assert.deepEqual(calls.find((call) => call.sql.includes('INSERT INTO organization_invitations'))?.values, [
    invitationId,
    organizationId,
    'invitee@example.com',
    'DEVELOPER',
    tokenHash,
    userId,
  ]);
});

test('invitation repository rejects calls without the matching authenticated tenant context', async () => {
  const { repository, calls } = fakeRepository();

  await assert.rejects(repository.list(organizationId), /matching authenticated tenant context/);
  await assert.rejects(
    withOrganizationContext(otherOrganizationId, () => repository.list(organizationId)),
    /matching authenticated tenant context/,
  );
  assert.equal(calls.length, 0);
});

test('invitation creation rejects non-managers and existing organization members', async () => {
  const nonManager = fakeRepository((sql) => (
    sql.includes('SELECT role') ? { rows: [{ role: 'DEVELOPER' }] } : { rows: [] }
  ));
  await assert.rejects(inTenant(() => nonManager.repository.create({
    id: invitationId,
    organizationId,
    email: 'invitee@example.com',
    role: 'VIEWER',
    tokenHash,
    createdBy: userId,
  })), (error: unknown) => error instanceof InvitationRepositoryError && error.code === 'FORBIDDEN');
  assert.equal(nonManager.calls.some((call) => call.sql.includes('INSERT INTO organization_invitations')), false);

  const existingMember = fakeRepository((sql) => {
    if (sql.includes('SELECT role') && sql.includes('FOR SHARE')) return { rows: [{ role: 'ADMIN' }] };
    if (sql.includes('INNER JOIN users')) return { rows: [{ '?column?': 1 }] };
    return { rows: [] };
  });
  await assert.rejects(inTenant(() => existingMember.repository.create({
    id: invitationId,
    organizationId,
    email: 'invitee@example.com',
    role: 'VIEWER',
    tokenHash,
    createdBy: userId,
  })), (error: unknown) => error instanceof InvitationRepositoryError && error.code === 'ALREADY_MEMBER');
  assert.equal(existingMember.calls.some((call) => call.sql.includes('INSERT INTO organization_invitations')), false);
});

test('acceptance locks the organization-scoped token row before checking email or creating membership', async () => {
  const { repository, calls } = fakeRepository((sql) => {
    if (sql.includes('FROM organization_invitations') && sql.includes('FOR UPDATE')) {
      return { rows: [{ id: invitationId, email: 'invitee@example.com', role: 'DEVELOPER', status: 'PENDING', isExpired: false }] };
    }
    if (sql.includes('FROM users WHERE id')) return { rows: [{ email: 'invitee@example.com' }] };
    if (sql.includes('FROM members WHERE organization_id') && sql.includes('FOR UPDATE')) return { rows: [] };
    return { rows: [] };
  });

  const result = await inTenant(() => repository.accept({ organizationId, userId, tokenHash }));

  assert.deepEqual(result, { status: 'ACCEPTED', email: 'invitee@example.com', role: 'DEVELOPER' });
  const invitationLock = calls.find((call) => call.sql.includes('FROM organization_invitations') && call.sql.includes('FOR UPDATE'));
  assert.ok(invitationLock);
  assert.deepEqual(invitationLock.values, [organizationId, tokenHash]);
  assert.ok(calls.some((call) => call.sql.includes('INSERT INTO members')));
  assert.ok(calls.some((call) => call.sql.includes('UPDATE users SET default_organization_id')));
  assert.ok(calls.some((call) => call.sql.includes("set_config('app.organization_id'") && call.values[0] === organizationId));
});

test('expired invitations are marked expired without membership changes', async () => {
  const { repository, calls } = fakeRepository((sql) => {
    if (sql.includes('FROM organization_invitations') && sql.includes('FOR UPDATE')) {
      return { rows: [{ id: invitationId, email: 'invitee@example.com', role: 'DEVELOPER', status: 'PENDING', isExpired: true }] };
    }
    return { rows: [] };
  });

  assert.deepEqual(await inTenant(() => repository.accept({ organizationId, userId, tokenHash })), { status: 'EXPIRED' });
  assert.ok(calls.some((call) => call.sql.includes("SET status = 'EXPIRED'")));
  assert.equal(calls.some((call) => call.sql.includes('INSERT INTO members')), false);
});

test('accepted invitations cannot be replayed', async () => {
  const { repository, calls } = fakeRepository((sql) => {
    if (sql.includes('FROM organization_invitations') && sql.includes('FOR UPDATE')) {
      return { rows: [{ id: invitationId, email: 'invitee@example.com', role: 'DEVELOPER', status: 'ACCEPTED', isExpired: false }] };
    }
    return { rows: [] };
  });

  assert.deepEqual(await inTenant(() => repository.accept({ organizationId, userId, tokenHash })), { status: 'USED' });
  assert.equal(calls.some((call) => call.sql.includes('INSERT INTO members')), false);
  assert.equal(calls.some((call) => call.sql.includes("SET status = 'ACCEPTED'")), false);
});

test('email mismatch preserves the pending invitation and existing members are not duplicated or elevated', async () => {
  const mismatch = fakeRepository((sql) => {
    if (sql.includes('FROM organization_invitations') && sql.includes('FOR UPDATE')) {
      return { rows: [{ id: invitationId, email: 'invitee@example.com', role: 'DEVELOPER', status: 'PENDING', isExpired: false }] };
    }
    if (sql.includes('FROM users WHERE id')) return { rows: [{ email: 'different@example.com' }] };
    return { rows: [] };
  });
  assert.deepEqual(await inTenant(() => mismatch.repository.accept({ organizationId, userId, tokenHash })), { status: 'EMAIL_MISMATCH' });
  assert.equal(mismatch.calls.some((call) => call.sql.includes('INSERT INTO members')), false);
  assert.equal(mismatch.calls.some((call) => call.sql.includes("SET status = 'ACCEPTED'")), false);

  const existingMember = fakeRepository((sql) => {
    if (sql.includes('FROM organization_invitations') && sql.includes('FOR UPDATE')) {
      return { rows: [{ id: invitationId, email: 'invitee@example.com', role: 'DEVELOPER', status: 'PENDING', isExpired: false }] };
    }
    if (sql.includes('FROM users WHERE id')) return { rows: [{ email: 'invitee@example.com' }] };
    if (sql.includes('FROM members WHERE organization_id') && sql.includes('FOR UPDATE')) return { rows: [{ role: 'VIEWER' }] };
    return { rows: [] };
  });
  assert.deepEqual(await inTenant(() => existingMember.repository.accept({ organizationId, userId, tokenHash })), {
    status: 'ALREADY_MEMBER',
    email: 'invitee@example.com',
    role: 'VIEWER',
  });
  assert.equal(existingMember.calls.some((call) => call.sql.includes('INSERT INTO members')), false);
  assert.ok(existingMember.calls.some((call) => call.sql.includes("SET status = 'ACCEPTED'")));
});
