import assert from 'node:assert/strict';
import test from 'node:test';
import type { CreateAccountWorkspaceInput } from '@bugzero/database';
import { createApiServer } from '../../src/server.js';
import { verifyPassword } from '../../src/auth/token-issuer.js';

const organizationId = '11111111-1111-4111-8111-111111111111';
const userId = '33333333-3333-4333-8333-333333333333';

test('registration persists an account, workspace, and owner membership before returning a signed session', async () => {
  const persisted: CreateAccountWorkspaceInput[] = [];
  let issuedIdentity: { userId: string; organizationId: string } | null = null;
  const app = createApiServer({
    async authenticate() { return null; },
    queue: { async enqueue() {} },
    auth: {
      accounts: {
        async createAccountWorkspace(input) {
          persisted.push(input);
        },
        async getAccountByEmail() {
          return null;
        },
      },
      members: {
        async getMembership() {
          throw new Error('Registration does not require a pre-existing membership lookup');
        },
      },
      async issueToken(requestedUserId, requestedOrganizationId) {
        issuedIdentity = { userId: requestedUserId, organizationId: requestedOrganizationId };
        return {
          accessToken: 'header.signed-token.signature',
          issuedAt: 1_800_000_000,
          expiresAt: 1_800_003_600,
        };
      },
    },
  });

  try {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: {
        displayName: 'A New User',
        email: 'NEW@EXAMPLE.COM',
        password: 'a-long-enough-password',
        workspaceName: 'My Workspace',
      },
    });

    test('authenticated session endpoint returns the persisted workspace and denies anonymous requests', async () => {
      const app = createApiServer({
        async authenticate(request) {
          return request.headers.authorization === 'Bearer valid-token'
            ? { userId, organizationId }
            : null;
        },
        queue: { async enqueue() {} },
        auth: {
          getSessionContext: async (requestedUserId, requestedOrganizationId) => {
            assert.equal(requestedUserId, userId);
            assert.equal(requestedOrganizationId, organizationId);
            return {
              user_id: userId,
              email: 'member@example.com',
              display_name: 'Member',
              organization_id: organizationId,
              organization_name: 'Member workspace',
              role: 'OWNER',
            };
          },
        },
      });

      try {
        const anonymous = await app.inject({ method: 'GET', url: '/auth/session' });
        assert.equal(anonymous.statusCode, 401);

        const authenticated = await app.inject({
          method: 'GET',
          url: '/auth/session',
          headers: { authorization: 'Bearer valid-token' },
        });
        assert.equal(authenticated.statusCode, 200, authenticated.body);
        assert.deepEqual(authenticated.json(), {
          user: { userId, email: 'member@example.com', displayName: 'Member', role: 'OWNER' },
          workspace: { organizationId, name: 'Member workspace' },
        });
      } finally {
        await app.close();
      }
    });
    assert.equal(response.statusCode, 201, response.body);
    const body = response.json();
    assert.equal('refreshToken' in body, false);
    assert.equal(body.user.role, 'OWNER');
    assert.equal(body.user.email, 'new@example.com');
    assert.equal(body.accessToken, 'header.signed-token.signature');
    const created = persisted[0];
    assert.ok(created);
    assert.equal(created.email, 'new@example.com');
    assert.equal(created.displayName, 'A New User');
    assert.equal(created.workspaceName, 'My Workspace');
    assert.match(created.workspaceSlug, /^my-workspace-[a-f0-9]{8}$/);
    assert.notEqual(created.userId, created.organizationId);
    assert.deepEqual(issuedIdentity, { userId: created.userId, organizationId: created.organizationId });
    assert.equal(await verifyPassword('a-long-enough-password', created.passwordHash), true);
    assert.equal(await verifyPassword('incorrect-password', created.passwordHash), false);
  } finally {
    await app.close();
  }
});

test('login verifies persisted credentials and membership in the selected tenant', async () => {
  const { hashPassword } = await import('../../src/auth/token-issuer.js');
  const passwordHash = await hashPassword('a-long-enough-password');
  let membershipLookups = 0;
  const app = createApiServer({
    async authenticate() { return null; },
    queue: { async enqueue() {} },
    auth: {
      accounts: {
        async createAccountWorkspace() {
          throw new Error('Login must not create an account');
        },
        async getAccountByEmail(email) {
          assert.equal(email, 'member@example.com');
          return {
            id: userId,
            email,
            display_name: 'Member',
            password_hash: passwordHash,
            default_organization_id: organizationId,
          };
        },
      },
      members: {
        async getMembership(requestedOrganizationId, requestedUserId) {
          membershipLookups += 1;
          assert.equal(requestedOrganizationId, organizationId);
          assert.equal(requestedUserId, userId);
          return {
            id: 'member',
            organization_id: organizationId,
            user_id: userId,
            role: 'OWNER',
            created_at: '',
            updated_at: '',
          };
        },
      },
      async issueToken(requestedUserId, requestedOrganizationId) {
        assert.equal(requestedUserId, userId);
        assert.equal(requestedOrganizationId, organizationId);
        return {
          accessToken: 'header.signed-token.signature',
          issuedAt: 1_800_000_000,
          expiresAt: 1_800_003_600,
        };
      },
    },
  });

  try {
    const invalid = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'member@example.com', password: 'incorrect-password' },
    });
    assert.equal(invalid.statusCode, 401);
    assert.equal(invalid.json().error, 'The email or password is not valid');
    assert.equal(membershipLookups, 0);

    const response = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'member@example.com', password: 'a-long-enough-password' },
    });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal('refreshToken' in response.json(), false);
    assert.equal(response.json().user.role, 'OWNER');
    assert.equal(response.json().user.email, 'member@example.com');
    assert.equal(membershipLookups, 1);
  } finally {
    await app.close();
  }
});

test('refresh-token endpoints are not registered', async () => {
  const app = createApiServer({
    async authenticate() { return null; },
    queue: { async enqueue() {} },
  });

  try {
    for (const url of ['/auth/refresh', '/auth/logout']) {
      const response = await app.inject({ method: 'POST', url, payload: {} });
      assert.equal(response.statusCode, 404);
    }
  } finally {
    await app.close();
  }
});
