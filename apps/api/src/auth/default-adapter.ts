import { createSignedTokenAuthenticator } from './signed-token.js';

const publicKey = process.env.AUTH_PUBLIC_KEY;
if (!publicKey) throw new Error('AUTH_PUBLIC_KEY must contain the trusted Ed25519 authentication public key');

export const authenticate = createSignedTokenAuthenticator({
  publicKey: publicKey.replace(/\\n/g, '\n'),
  issuer: process.env.AUTH_ISSUER ?? 'bugzero-auth',
  audience: process.env.AUTH_AUDIENCE ?? 'bugzero-api',
});
