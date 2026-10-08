import assert from 'node:assert/strict';
import test from 'node:test';
import { generateKeyPairSync, sign } from 'node:crypto';
import { createApiServer } from '../../src/server.js';
import { createSignedTokenAuthenticator } from '../../src/auth/signed-token.js';

const userId = '33333333-3333-4333-8333-333333333333';
const organizationId = '11111111-1111-4111-8111-111111111111';
const keyPair = generateKeyPairSync('ed25519');
const otherKeyPair = generateKeyPairSync('ed25519');
const now = 1_800_000_000_000;

function createToken(
  overrides: Record<string, unknown> = {},
  signingKey: typeof keyPair.privateKey = keyPair.privateKey,
): string {
  const header = Buffer.from(JSON.stringify({ alg: 'EdDSA', typ: 'JWT' })).toString('base64url');
  const claims = Buffer.from(JSON.stringify({
    sub: userId,
    org: organizationId,
    iss: 'bugzero-auth',
    aud: 'bugzero-api',
    iat: Math.floor(now / 1000) - 1,
    exp: Math.floor(now / 1000) + 300,
    ...overrides,
  })).toString('base64url');
  const content = `${header}.${claims}`;
  return `${content}.${sign(null, Buffer.from(content), signingKey).toString('base64url')}`;
}

test('signed backend token authenticates its verified user and organization claims', async () => {
  const authenticate = createSignedTokenAuthenticator({
    publicKey: keyPair.publicKey,
    issuer: 'bugzero-auth',
    audience: 'bugzero-api',
    now: () => now,
  });
  const principal = await authenticate({
    headers: { authorization: `Bearer ${createToken()}` },
  } as Parameters<typeof authenticate>[0]);

  assert.deepEqual(principal, { userId, organizationId });
});

test('invalid, expired, and wrong-audience tokens are rejected', async () => {
  const authenticate = createSignedTokenAuthenticator({
    publicKey: keyPair.publicKey,
    issuer: 'bugzero-auth',
    audience: 'bugzero-api',
    now: () => now,
  });
  const authenticateHeader = (authorization: string) => authenticate({
    headers: { authorization },
  } as Parameters<typeof authenticate>[0]);

  assert.equal(await authenticateHeader('Bearer malformed.token'), null);
  assert.equal(await authenticateHeader(`Bearer ${createToken({ exp: Math.floor(now / 1000) })}`), null);
  assert.equal(await authenticateHeader(`Bearer ${createToken({ aud: 'other-api' })}`), null);
  assert.equal(await authenticateHeader(`Bearer ${createToken().slice(0, -2)}xx`), null);
});

test('protected API requests reject missing authentication and deny users without organization membership', async () => {
  const authenticateToken = createSignedTokenAuthenticator({
    publicKey: keyPair.publicKey,
    issuer: 'bugzero-auth',
    audience: 'bugzero-api',
    now: () => now,
  });
  const app = createApiServer({
    authenticate: authenticateToken,
    queue: { async enqueue() {} },
    members: { async getMembership() { return null; } },
  });

  try {
    const anonymous = await app.inject({ method: 'GET', url: '/repositories' });
    assert.equal(anonymous.statusCode, 401);

    const authenticated = await app.inject({
      method: 'GET',
      url: '/repositories',
      headers: { authorization: `Bearer ${createToken()}` },
    });
    assert.equal(authenticated.statusCode, 403);
    assert.deepEqual(authenticated.json(), { error: 'Organization membership required' });
  } finally {
    await app.close();
  }
});

test('JWT with an invalid signature is rejected', async () => {
  const authenticate = createSignedTokenAuthenticator({
    publicKey: keyPair.publicKey,
    issuer: 'bugzero-auth',
    audience: 'bugzero-api',
    now: () => now,
  });
  const token = createToken({}, otherKeyPair.privateKey);
  assert.equal(await authenticate({ headers: { authorization: `Bearer ${token}` } } as Parameters<typeof authenticate>[0]), null);
});

test('JWT with the wrong issuer is rejected', async () => {
  const authenticate = createSignedTokenAuthenticator({
    publicKey: keyPair.publicKey,
    issuer: 'bugzero-auth',
    audience: 'bugzero-api',
    now: () => now,
  });
  const token = createToken({ iss: 'other-issuer' });
  assert.equal(await authenticate({ headers: { authorization: `Bearer ${token}` } } as Parameters<typeof authenticate>[0]), null);
});

test('JWT with the wrong audience is rejected', async () => {
  const authenticate = createSignedTokenAuthenticator({
    publicKey: keyPair.publicKey,
    issuer: 'bugzero-auth',
    audience: 'bugzero-api',
    now: () => now,
  });
  const token = createToken({ aud: 'other-api' });
  assert.equal(await authenticate({ headers: { authorization: `Bearer ${token}` } } as Parameters<typeof authenticate>[0]), null);
});

test('expired JWT is rejected', async () => {
  const authenticate = createSignedTokenAuthenticator({
    publicKey: keyPair.publicKey,
    issuer: 'bugzero-auth',
    audience: 'bugzero-api',
    now: () => now,
  });
  const token = createToken({ exp: Math.floor(now / 1000) });
  assert.equal(await authenticate({ headers: { authorization: `Bearer ${token}` } } as Parameters<typeof authenticate>[0]), null);
});
