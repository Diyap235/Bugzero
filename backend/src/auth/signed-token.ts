import { createPublicKey, type KeyLike } from 'node:crypto';
import { jwtVerify } from 'jose';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';

import type { AuthenticatedAnalysisPrincipal } from '../modules/analysis/routes.js';

const TokenHeaderSchema = z.object({
  alg: z.literal('EdDSA'),
  typ: z.literal('JWT'),
}).strict();

const TokenClaimsSchema = z.object({
  sub: z.string().uuid(),
  org: z.string().uuid(),
  iss: z.string().min(1),
  aud: z.string().min(1),
  iat: z.number().int().nonnegative(),
  exp: z.number().int().positive(),
}).strict();

export interface SignedTokenAuthenticatorOptions {
  publicKey: string | Buffer | KeyLike;
  issuer: string;
  audience: string;
  now?: () => number;
}

export function createSignedTokenAuthenticator(
  options: SignedTokenAuthenticatorOptions,
): (request: FastifyRequest) => Promise<AuthenticatedAnalysisPrincipal | null> {
  const publicKey = typeof options.publicKey === 'string' || Buffer.isBuffer(options.publicKey)
    ? createPublicKey(options.publicKey)
    : options.publicKey;
  if (publicKey.asymmetricKeyType !== 'ed25519') {
    throw new Error('AUTH_PUBLIC_KEY must be an Ed25519 public key');
  }
  const now = options.now ?? Date.now;

  return async (request) => {
    const authorization = request.headers.authorization;
    if (typeof authorization !== 'string' || authorization.length > 8192) return null;
    const match = /^Bearer\s+([^\s]+)$/i.exec(authorization);
    if (!match) return null;

    try {
      const { protectedHeader, payload } = await jwtVerify(match[1], publicKey, {
        algorithms: ['EdDSA'],
        issuer: options.issuer,
        audience: options.audience,
        currentDate: new Date(now()),
      });
      const header = TokenHeaderSchema.safeParse(protectedHeader);
      const claims = TokenClaimsSchema.safeParse(payload);
      if (!header.success || !claims.success) return null;

      const currentTime = Math.floor(now() / 1000);
      if (claims.data.iat > currentTime + 60 || claims.data.exp <= claims.data.iat) return null;

      return {
        userId: claims.data.sub,
        organizationId: claims.data.org,
      };
    } catch {
      return null;
    }
  };
}
