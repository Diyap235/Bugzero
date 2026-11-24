import assert from 'node:assert/strict';
import test from 'node:test';
import { createApiServer } from '../src/server.js';

test('login limits repeated attempts per client and returns a generic retry response', async () => {
  let accountLookups = 0;
  const app = createApiServer({
    async authenticate() {
      return null;
    },
    auth: {
      accounts: {
        async createAccountWorkspace() {
          throw new Error('Login must not create an account');
        },
        async getAccountByEmail() {
          accountLookups += 1;
          return null;
        },
      },
      members: {
        async getMembership() {
          throw new Error('An unknown account must not trigger membership lookup');
        },
      },
    },
  });

  try {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'unknown@example.com', password: 'incorrect-password' },
      });
      assert.equal(response.statusCode, 401);
      assert.deepEqual(response.json(), { error: 'The email or password is not valid' });
    }

    const limited = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'unknown@example.com', password: 'incorrect-password' },
    });

    assert.equal(limited.statusCode, 429);
    assert.deepEqual(limited.json(), { error: 'Too many login attempts. Please try again later.' });
    assert.ok(Number(limited.headers['retry-after']) > 0);
    assert.equal(accountLookups, 10);
    assert.equal(limited.body.includes('incorrect-password'), false);
    assert.equal(limited.body.includes('accessToken'), false);
  } finally {
    await app.close();
  }
});
