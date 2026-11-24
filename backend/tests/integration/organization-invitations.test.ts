import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import type { OrganizationInvitation, OrganizationInvitationRole } from '@bugzero/contracts';
import type { AcceptInvitationResult, MemberRole, OrganizationInvitationRepository } from '@bugzero/database';
import { getOrganizationContext } from '@bugzero/database';
import { createApiServer } from '../../src/server.js';

const userId = '33333333-3333-4333-8333-333333333333';
const organizationId = '11111111-1111-4111-8111-111111111111';
const otherOrganizationId = '22222222-2222-4222-8222-222222222222';
const token = 'abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG';

function invitation(
  overrides: Partial<OrganizationInvitation> = {},
): OrganizationInvitation {
  return {
    id: '44444444-4444-4444-8444-444444444444',
    organizationId,
    email: 'invitee@example.com',
    role: 'DEVELOPER',
    status: 'PENDING',
    expiresAt: '2027-01-01T00:00:00.000Z',
    createdAt: '2026-11-14T00:00:00.000Z',
    acceptedAt: null,
    ...overrides,
  };
}

function createInvitationTestApi(options: {
  role?: MemberRole | null;
  acceptResult?: AcceptInvitationResult;
} = {}) {
  const created: Array<{
    organizationId: string;
    email: string;
    role: OrganizationInvitationRole;
    tokenHash: string;
    createdBy: string;
  }> = [];
  const acceptanceCalls: Array<{ organizationId: string; userId: string; tokenHash: string; context?: string }> = [];
  let issueCount = 0;
  const invitations: Pick<OrganizationInvitationRepository, 'create' | 'list' | 'accept'> = {
    async create(input) {
      created.push(input);
      assert.equal(getOrganizationContext(), organizationId);
      return invitation({ email: input.email, role: input.role });
    },
    async list(requestedOrganizationId) {
      assert.equal(requestedOrganizationId, organizationId);
      return [invitation()];
    },
    async accept(input) {
      acceptanceCalls.push({ ...input, context: getOrganizationContext() });
      return options.acceptResult ?? { status: 'ACCEPTED', email: 'invitee@example.com', role: 'DEVELOPER' };
    },
  };

  const app = createApiServer({
    logger: false,
    async authenticate(request) {
      return request.headers.authorization === 'Bearer signed-user'
        ? { userId, organizationId }
        : null;
    },
    members: {
      async getMembership(requestedOrganizationId, requestedUserId) {
        assert.equal(requestedOrganizationId, organizationId);
        assert.equal(requestedUserId, userId);
        if (!options.role) return null;
        return {
          id: 'member',
          organization_id: organizationId,
          user_id: userId,
          role: options.role,
          created_at: '',
          updated_at: '',
        };
      },
    },
    auth: {
      invitations,
      async issueToken(requestedUserId, requestedOrganizationId) {
        issueCount += 1;
        assert.equal(requestedUserId, userId);
        assert.equal(requestedOrganizationId, organizationId);
        return { accessToken: 'header.access-token.signature', issuedAt: 1_800_000_000, expiresAt: 1_800_003_600 };
      },
    },
  });

  return { app, created, acceptanceCalls, getIssueCount: () => issueCount };
}

test('only organization owners and admins can create or list invitations', async () => {
  const roles: Array<MemberRole | null> = [null, 'DEVELOPER', 'SECURITY_REVIEWER', 'VIEWER'];
  for (const role of roles) {
    const { app, created } = createInvitationTestApi({ role });
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/organizations/invitations',
        headers: role ? { authorization: 'Bearer signed-user' } : {},
        payload: { email: 'invitee@example.com', role: 'DEVELOPER' },
      });
      assert.equal(response.statusCode, role ? 403 : 401);
      assert.equal(created.length, 0);

      const listed = await app.inject({
        method: 'GET',
        url: '/organizations/invitations',
        headers: role ? { authorization: 'Bearer signed-user' } : {},
      });
      assert.equal(listed.statusCode, role ? 403 : 401);
    } finally {
      await app.close();
    }
  }
});

test('organization admins can create and list invitations', async () => {
  const { app, created } = createInvitationTestApi({ role: 'ADMIN' });
  try {
    const response = await app.inject({
      method: 'POST',
      url: '/organizations/invitations',
      headers: { authorization: 'Bearer signed-user' },
      payload: { email: 'invitee@example.com', role: 'VIEWER' },
    });
    assert.equal(response.statusCode, 201, response.body);
    assert.equal(created[0]?.role, 'VIEWER');

    const listed = await app.inject({
      method: 'GET',
      url: '/organizations/invitations',
      headers: { authorization: 'Bearer signed-user' },
    });
    assert.equal(listed.statusCode, 200);
  } finally {
    await app.close();
  }
});

test('invitation creation scopes organization from the authenticated principal and stores only a token digest', async () => {
  const { app, created } = createInvitationTestApi({ role: 'OWNER' });
  try {
    const response = await app.inject({
      method: 'POST',
      url: '/organizations/invitations',
      headers: { authorization: 'Bearer signed-user' },
      payload: {
        email: ' Invitee@Example.com ',
        role: 'DEVELOPER',
        organizationId: otherOrganizationId,
      },
    });
    assert.equal(response.statusCode, 400, response.body);
    assert.equal(created.length, 0);

    const valid = await app.inject({
      method: 'POST',
      url: '/organizations/invitations',
      headers: { authorization: 'Bearer signed-user' },
      payload: { email: ' Invitee@Example.com ', role: 'DEVELOPER' },
    });
    assert.equal(valid.statusCode, 201, valid.body);
    const body = valid.json() as { token: string; invitation: OrganizationInvitation };
    assert.match(body.token, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(body.invitation.email, 'invitee@example.com');
    assert.equal(body.invitation.organizationId, organizationId);
    assert.equal(created[0]?.organizationId, organizationId);
    assert.equal(created[0]?.tokenHash, createHash('sha256').update(body.token).digest('hex'));
    assert.notEqual(created[0]?.tokenHash, body.token);

    const listed = await app.inject({
      method: 'GET',
      url: '/organizations/invitations',
      headers: { authorization: 'Bearer signed-user' },
    });
    assert.equal(listed.statusCode, 200);
    assert.equal(listed.body.includes(body.token), false);
  } finally {
    await app.close();
  }
});

test('OWNER and ADMIN roles cannot be assigned through an invitation request', async () => {
  const { app, created } = createInvitationTestApi({ role: 'OWNER' });
  try {
    for (const role of ['OWNER', 'ADMIN', 'root']) {
      const response = await app.inject({
        method: 'POST',
        url: '/organizations/invitations',
        headers: { authorization: 'Bearer signed-user' },
        payload: { email: 'invitee@example.com', role },
      });
      assert.equal(response.statusCode, 400);
    }
    assert.equal(created.length, 0);
  } finally {
    await app.close();
  }
});

test('acceptance validates the organization scope, authenticated email, and invitation status', async () => {
  const cases: Array<{ result: AcceptInvitationResult; statusCode: number }> = [
    { result: { status: 'INVALID' }, statusCode: 404 },
    { result: { status: 'EXPIRED' }, statusCode: 410 },
    { result: { status: 'USED' }, statusCode: 409 },
    { result: { status: 'EMAIL_MISMATCH' }, statusCode: 403 },
  ];

  for (const scenario of cases) {
    const { app, acceptanceCalls, getIssueCount } = createInvitationTestApi({
      role: 'DEVELOPER',
      acceptResult: scenario.result,
    });
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/organizations/invitations/accept',
        headers: { authorization: 'Bearer signed-user' },
        payload: { organizationId: otherOrganizationId, token },
      });
      assert.equal(response.statusCode, scenario.statusCode);
      assert.equal(acceptanceCalls[0]?.organizationId, otherOrganizationId);
      assert.equal(acceptanceCalls[0]?.context, otherOrganizationId);
      assert.equal(acceptanceCalls[0]?.tokenHash, createHash('sha256').update(token).digest('hex'));
      assert.equal(getIssueCount(), 0);
    } finally {
      await app.close();
    }
  }
});

test('acceptance replaces the session with the invited organization and preserves an existing membership role', async () => {
  const { app, acceptanceCalls } = createInvitationTestApi({
    role: 'DEVELOPER',
    acceptResult: { status: 'ALREADY_MEMBER', email: 'invitee@example.com', role: 'VIEWER' },
  });
  try {
    const response = await app.inject({
      method: 'POST',
      url: '/organizations/invitations/accept',
      headers: { authorization: 'Bearer signed-user' },
      payload: { organizationId, token },
    });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json().user.role, 'VIEWER');
    assert.equal(response.json().user.email, 'invitee@example.com');
    assert.equal(acceptanceCalls.length, 1);
  } finally {
    await app.close();
  }
});

test('concurrent acceptance consumes one invitation once and rejects the competing request', async () => {
  let used = false;
  let issueCount = 0;
  const invitations: Pick<OrganizationInvitationRepository, 'create' | 'list' | 'accept'> = {
    async create(input) { return invitation({ email: input.email, role: input.role }); },
    async list() { return []; },
    async accept() {
      if (used) return { status: 'USED' };
      used = true;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return { status: 'ACCEPTED', email: 'invitee@example.com', role: 'DEVELOPER' };
    },
  };
  const concurrentApp = createApiServer({
    logger: false,
    async authenticate() { return { userId, organizationId }; },
    members: {
      async getMembership() {
        return { id: 'member', organization_id: organizationId, user_id: userId, role: 'DEVELOPER', created_at: '', updated_at: '' };
      },
    },
    auth: {
      invitations,
      async issueToken() {
        issueCount += 1;
        return { accessToken: 'header.access-token.signature', issuedAt: 1_800_000_000, expiresAt: 1_800_003_600 };
      },
    },
  });

  try {
    const payload = { organizationId, token };
    const responses = await Promise.all([1, 2].map(() => concurrentApp.inject({
      method: 'POST',
      url: '/organizations/invitations/accept',
      headers: { authorization: 'Bearer signed-user' },
      payload,
    })));
    assert.deepEqual(responses.map((response) => response.statusCode).sort(), [200, 409]);
  } finally {
    await concurrentApp.close();
  }
  assert.equal(issueCount, 1);
});
