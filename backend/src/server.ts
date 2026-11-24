import Fastify, {
  type FastifyInstance,
  type FastifyLoggerOptions,
  type FastifyRequest,
} from 'fastify';
import {
  analysisRepository,
  aiInvestigationRepository,
  authRepository,
  commitsRepository,
  membersRepository,
  organizationInvitationRepository,
  evidenceRepository,
  findingsRepository,
  healthRepository,
  reportsRepository,
  riskAssessmentRepository,
  repositoriesRepository,
  requireNeonDatabaseUrl,
  type AnalysisRepository,
  type CommitRepository,
  type MemberRepository,
  type OrganizationInvitationRepository,
  type RepositoryRepository,
  withOrganizationContext,
} from '@bugzero/database';

import {
  registerAnalysisRoutes,
  type AnalysisApiDependencies,
  type AuthenticatedAnalysisPrincipal,
} from './modules/analysis/routes.js';
import { registerProductRoutes } from './modules/product/routes.js';
import type { ProductRouteDependencies } from './modules/product/routes.js';
import { registerAuthRoutes } from './auth/routes.js';
import { registerOrganizationInvitationRoutes } from './auth/organization-invitations.js';
import { registerLocalZipRepositoryRoute } from './modules/repositories/local-zip.js';

export const serverName = 'bugzero-api';

export interface ApiServerOptions {
  authenticate(request: Parameters<AnalysisApiDependencies['authenticate']>[0]): Promise<AuthenticatedAnalysisPrincipal | null>;
  logger?: FastifyLoggerOptions | boolean;
  startLocalWorker?: () => Promise<{ stop(): Promise<void> }>;
  analysis?: Pick<
    AnalysisRepository,
    | 'ensureDefaultProfile'
    | 'getLatestProfile'
    | 'createOrGetActiveWork'
    | 'getRun'
    | 'getLatestJobForRun'
    | 'updateJobStatus'
    | 'updateRunStatus'
  >;
  repositories?: Pick<RepositoryRepository, 'getById'>;
  commits?: Pick<CommitRepository, 'getByCommitSha'>;
  members?: Pick<MemberRepository, 'getMembership'>;
  auth?: {
    accounts?: Pick<typeof authRepository, 'createAccountWorkspace' | 'getAccountByEmail'>;
    getSessionContext?: typeof authRepository.getSessionContext;
    members?: Pick<MemberRepository, 'getMembership'>;
    invitations?: Pick<OrganizationInvitationRepository, 'create' | 'list' | 'accept'>;
    issueToken?: (userId: string, organizationId: string) => Promise<{
      accessToken: string;
      issuedAt: number;
      expiresAt: number;
    }>;
  };
  product?: Partial<Omit<ProductRouteDependencies, 'authenticate'>> & {
    authenticate?: ProductRouteDependencies['authenticate'];
  };
  localZip?: {
    members?: Pick<MemberRepository, 'getMembership'>;
    repositories?: Pick<RepositoryRepository, 'createWithCommitAndFiles'>;
  };
}

export function createApiServer(options: ApiServerOptions): FastifyInstance {
  const server = Fastify({ logger: options.logger ?? true });
  server.addContentTypeParser('application/zip', {
    parseAs: 'buffer',
    bodyLimit: 10 * 1024 * 1024,
  }, (_request, body, done) => done(null, body));
  const principals = new WeakMap<FastifyRequest, AuthenticatedAnalysisPrincipal | null>();
  const authenticate = async (request: FastifyRequest): Promise<AuthenticatedAnalysisPrincipal | null> => {
    if (principals.has(request)) return principals.get(request) ?? null;
    const principal = await options.authenticate(request);
    const validatedPrincipal = principal
      && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(principal.userId)
      && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(principal.organizationId)
      ? principal
      : null;
    principals.set(request, validatedPrincipal);
    return validatedPrincipal;
  };
  server.addHook('onRoute', (routeOptions) => {
    const originalHandler = routeOptions.handler.bind(server);
    routeOptions.handler = async (request, reply) => {
      const principal = await authenticate(request);
      if (!principal) return originalHandler(request, reply);
      return withOrganizationContext(principal.organizationId, async () =>
        originalHandler(request, reply));
    };
  });
  server.setErrorHandler((error, request, reply) => {
    const candidateStatusCode = typeof error === 'object' && error !== null
      && 'statusCode' in error && typeof error.statusCode === 'number'
      ? error.statusCode
      : null;
    request.log.error({
      requestId: request.id,
      statusCode: candidateStatusCode,
    }, 'Unhandled API request error');
    const statusCode = candidateStatusCode !== null && candidateStatusCode >= 400 && candidateStatusCode < 500
      ? candidateStatusCode
      : 500;
    return reply.code(statusCode).send({
      error: statusCode === 500 ? 'Internal server error' : 'Request could not be completed',
      code: statusCode === 500 ? 'INTERNAL_ERROR' : 'REQUEST_ERROR',
    });
  });
  registerAnalysisRoutes(server, {
    authenticate,
    analysis: options.analysis ?? analysisRepository,
    repositories: options.repositories ?? repositoriesRepository,
    commits: options.commits ?? commitsRepository,
    members: options.members ?? membersRepository,
  });
  registerProductRoutes(server, {
    authenticate,
    members: options.product?.members ?? options.members ?? membersRepository,
    repositories: options.product?.repositories ?? repositoriesRepository,
    commits: options.product?.commits ?? commitsRepository,
    analysis: options.product?.analysis ?? analysisRepository,
    findings: options.product?.findings ?? findingsRepository,
    evidence: options.product?.evidence ?? evidenceRepository,
    risks: options.product?.risks ?? riskAssessmentRepository,
    health: options.product?.health ?? healthRepository,
    reports: options.product?.reports ?? reportsRepository,
    aiInvestigations: options.product?.aiInvestigations ?? aiInvestigationRepository,
  });
  registerLocalZipRepositoryRoute(server, {
    authenticate,
    members: options.localZip?.members ?? options.product?.members ?? options.members ?? membersRepository,
    repositories: options.localZip?.repositories ?? repositoriesRepository,
  });
  registerAuthRoutes(server, {
    authenticate,
    accounts: options.auth?.accounts ?? authRepository,
    getSessionContext: options.auth?.getSessionContext ?? authRepository.getSessionContext.bind(authRepository),
    members: options.auth?.members ?? options.members ?? membersRepository,
    issueToken: options.auth?.issueToken,
  });
  registerOrganizationInvitationRoutes(server, {
    authenticate,
    members: options.auth?.members ?? options.members ?? membersRepository,
    invitations: options.auth?.invitations ?? organizationInvitationRepository,
    issueToken: options.auth?.issueToken,
  });
  return server;
}

export async function startApiServer(options: ApiServerOptions, port = Number(process.env.PORT ?? '3001')): Promise<FastifyInstance> {
  requireNeonDatabaseUrl('DATABASE_URL');
  const server = createApiServer(options);
  let localWorker: { stop(): Promise<void> } | undefined;
  if (options.startLocalWorker) {
    server.addHook('onClose', async () => {
      await localWorker?.stop();
    });
  }
  try {
    await server.listen({ host: process.env.HOST ?? '0.0.0.0', port });
    if (options.startLocalWorker) localWorker = await options.startLocalWorker();
    return server;
  } catch (error) {
    if (server.server.listening) {
      try {
        await server.close();
      } catch {
        // Preserve the startup error after attempting to release server resources.
      }
    }
    throw error;
  }
}
