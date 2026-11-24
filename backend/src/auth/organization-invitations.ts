import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  AcceptOrganizationInvitationRequestSchema,
  AuthSessionResponseSchema,
  CreateOrganizationInvitationRequestSchema,
  CreateOrganizationInvitationResponseSchema,
  ListOrganizationInvitationsResponseSchema,
} from '@bugzero/contracts';
import type {
  MemberRepository,
  OrganizationInvitationRepository,
} from '@bugzero/database';
import { InvitationRepositoryError, withOrganizationContext } from '@bugzero/database';
import type { AuthenticatedAnalysisPrincipal } from '../modules/analysis/routes.js';
import { issueAccessToken } from './token-issuer.js';

const INVITATION_TOKEN_BYTES = 32;

interface OrganizationInvitationRouteDependencies {
  authenticate(request: FastifyRequest): Promise<AuthenticatedAnalysisPrincipal | null>;
  members: Pick<MemberRepository, 'getMembership'>;
  invitations: Pick<OrganizationInvitationRepository, 'create' | 'list' | 'accept'>;
  issueToken(userId: string, organizationId: string): Promise<{
    accessToken: string;
    issuedAt: number;
    expiresAt: number;
  }>;
}

function isOrganizationManager(role: string | undefined): boolean {
  return role === 'OWNER' || role === 'ADMIN';
}

function hashInvitationToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function invitationRepositoryError(error: unknown): error is InvitationRepositoryError {
  return error instanceof InvitationRepositoryError;
}

function unavailableInvitation(reply: FastifyReply) {
  return reply.code(404).send({ error: 'This invitation is invalid or unavailable.' });
}

export function registerOrganizationInvitationRoutes(
  server: FastifyInstance,
  dependencies: Partial<OrganizationInvitationRouteDependencies>
    & Pick<OrganizationInvitationRouteDependencies, 'authenticate'>,
): void {
  const members = dependencies.members;
  const invitations = dependencies.invitations;
  const issueToken = dependencies.issueToken ?? issueAccessToken;
  if (!members || !invitations) {
    throw new Error('Member and invitation repositories are required for organization invitation routes');
  }

  server.post('/organizations/invitations', async (request, reply) => {
    const principal = await dependencies.authenticate(request);
    if (!principal) return reply.code(401).send({ error: 'Authentication required' });

    const membership = await members.getMembership(principal.organizationId, principal.userId);
    if (!isOrganizationManager(membership?.role)) {
      return reply.code(403).send({ error: 'Organization owner or admin access is required' });
    }

    const parsed = CreateOrganizationInvitationRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Enter a valid email address and an allowed invitation role' });
    }

    const token = randomBytes(INVITATION_TOKEN_BYTES).toString('base64url');
    try {
      const invitation = await invitations.create({
        id: randomUUID(),
        organizationId: principal.organizationId,
        email: parsed.data.email.toLowerCase(),
        role: parsed.data.role,
        tokenHash: hashInvitationToken(token),
        createdBy: principal.userId,
      });
      return reply.code(201).send(CreateOrganizationInvitationResponseSchema.parse({ invitation, token }));
    } catch (error) {
      if (invitationRepositoryError(error)) {
        if (error.code === 'FORBIDDEN') {
          return reply.code(403).send({ error: 'Organization owner or admin access is required' });
        }
        return reply.code(409).send({
          error: error.code === 'ALREADY_MEMBER'
            ? 'This account is already a member of the organization'
            : 'A pending invitation already exists for this email',
        });
      }
      throw error;
    }
  });

  server.get('/organizations/invitations', async (request, reply) => {
    const principal = await dependencies.authenticate(request);
    if (!principal) return reply.code(401).send({ error: 'Authentication required' });

    const membership = await members.getMembership(principal.organizationId, principal.userId);
    if (!isOrganizationManager(membership?.role)) {
      return reply.code(403).send({ error: 'Organization owner or admin access is required' });
    }

    const rows = await invitations.list(principal.organizationId);
    return reply.send(ListOrganizationInvitationsResponseSchema.parse({ invitations: rows }));
  });

  server.post('/organizations/invitations/accept', async (request, reply) => {
    const principal = await dependencies.authenticate(request);
    if (!principal) return reply.code(401).send({ error: 'Sign in with the invited account to accept this invitation' });

    const parsed = AcceptOrganizationInvitationRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'The invitation link is invalid' });

    const result = await withOrganizationContext(parsed.data.organizationId, () => invitations.accept({
      organizationId: parsed.data.organizationId,
      userId: principal.userId,
      tokenHash: hashInvitationToken(parsed.data.token),
    }));

    switch (result.status) {
      case 'INVALID':
        return unavailableInvitation(reply);
      case 'EXPIRED':
        return reply.code(410).send({ error: 'This invitation has expired' });
      case 'USED':
        return reply.code(409).send({ error: 'This invitation has already been used' });
      case 'EMAIL_MISMATCH':
        return reply.code(403).send({ error: 'Sign in with the email address this invitation was sent to' });
      case 'ACCEPTED':
      case 'ALREADY_MEMBER':
        break;
    }

    const sessionToken = await issueToken(principal.userId, parsed.data.organizationId);
    return reply.send(AuthSessionResponseSchema.parse({
      ...sessionToken,
      user: {
        userId: principal.userId,
        email: result.email,
        role: result.role,
      },
    }));
  });
}
