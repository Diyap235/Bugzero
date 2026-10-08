import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  AuthenticatedSessionResponseSchema,
  AuthSessionResponseSchema,
  RegisterAccountRequestSchema,
  SignInRequestSchema,
} from '@bugzero/contracts';
import type { AuthRepository, MemberRepository } from '@bugzero/database';
import { withOrganizationContext } from '@bugzero/database';
import type { AuthenticatedAnalysisPrincipal } from '../modules/analysis/routes.js';
import { hashPassword, issueAccessToken, verifyPassword } from './token-issuer.js';

interface AuthRouteDependencies {
  authenticate(request: FastifyRequest): Promise<AuthenticatedAnalysisPrincipal | null>;
  accounts: Pick<AuthRepository, 'createAccountWorkspace' | 'getAccountByEmail'>;
  getSessionContext(userId: string, organizationId: string): ReturnType<AuthRepository['getSessionContext']>;
  members: Pick<MemberRepository, 'getMembership'>;
  issueToken(userId: string, organizationId: string): Promise<{
    accessToken: string;
    issuedAt: number;
    expiresAt: number;
  }>;
}

function workspaceSlug(name: string, suffix: string): string {
  const normalized = name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  const base = normalized.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50);
  return `${base || 'workspace'}-${suffix.replace(/-/g, '').slice(0, 8)}`;
}

function authResponse(
  token: Awaited<ReturnType<AuthRouteDependencies['issueToken']>>,
  user: { userId: string; email: string; role: string },
) {
  return AuthSessionResponseSchema.parse({ ...token, user });
}

export function registerAuthRoutes(
  server: FastifyInstance,
  dependencies: Partial<AuthRouteDependencies> & Pick<AuthRouteDependencies, 'authenticate' | 'getSessionContext'>,
): void {
  const accounts = dependencies.accounts;
  const members = dependencies.members;
  const issueToken = dependencies.issueToken ?? issueAccessToken;
  if (!accounts || !members) throw new Error('Account and member repositories are required for authentication routes');

  const registerAccount = async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = RegisterAccountRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Enter a valid name, email, password, and workspace name' });
    }

    const userId = randomUUID();
    const organizationId = randomUUID();
    const email = parsed.data.email.trim().toLowerCase();
    const token = await issueToken(userId, organizationId);
    try {
      await accounts.createAccountWorkspace({
        userId,
        organizationId,
        email,
        displayName: parsed.data.displayName,
        passwordHash: await hashPassword(parsed.data.password),
        workspaceName: parsed.data.workspaceName,
        workspaceSlug: workspaceSlug(parsed.data.workspaceName, organizationId),
      });
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505') {
        return reply.code(409).send({ error: 'An account with this email already exists' });
      }
      throw error;
    }

    return reply.code(201).send(authResponse(token, {
      userId,
      email,
      role: 'OWNER',
    }));
  };
  server.post('/auth/signup', registerAccount);
  server.post('/auth/register', registerAccount);

  server.post('/auth/login', async (request, reply) => {
    const parsed = SignInRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Enter a valid email and password' });

    const email = parsed.data.email.trim().toLowerCase();
    const account = await accounts.getAccountByEmail(email);
    const passwordMatches = await verifyPassword(parsed.data.password, account?.password_hash ?? null);
    const organizationId = account?.default_organization_id;
    if (!account || !passwordMatches || !organizationId) {
      return reply.code(401).send({ error: 'The email or password is not valid' });
    }

    const membership = await withOrganizationContext(
      organizationId,
      () => members.getMembership(organizationId, account.id),
    );
    if (!membership) return reply.code(401).send({ error: 'The email or password is not valid' });

    const token = await issueToken(account.id, organizationId);

    return reply.send(authResponse(token, {
      userId: account.id,
      email: account.email,
      role: membership.role,
    }));
  });

  server.get('/auth/session', async (request, reply) => {
    const principal = await dependencies.authenticate(request);
    if (!principal) return reply.code(401).send({ error: 'Authentication required' });
    const session = await dependencies.getSessionContext(principal.userId, principal.organizationId);
    if (!session) return reply.code(401).send({ error: 'Authentication required' });
    return reply.send(AuthenticatedSessionResponseSchema.parse({
      user: {
        userId: session.user_id,
        email: session.email,
        displayName: session.display_name,
        role: session.role,
      },
      workspace: {
        organizationId: session.organization_id,
        name: session.organization_name,
      },
    }));
  });
}
