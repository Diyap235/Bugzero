import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { Redis } from 'ioredis';
import {
  analysisRepository,
  commitsRepository,
  membersRepository,
  evidenceRepository,
  findingsRepository,
  healthRepository,
  reportsRepository,
  riskAssessmentRepository,
  repositoriesRepository,
  type AnalysisRepository,
  type CommitRepository,
  type MemberRepository,
  type RepositoryRepository,
  withOrganizationContext,
} from '@bugzero/database';
import { getRedisUrl } from '@bugzero/config';
import { GitHubRepositoryProvider } from '@bugzero/workers/github-provider';
import {
  createAnalysisQueue,
  enqueueAnalysisJob,
  type AnalysisQueuePayload,
} from '@bugzero/workers/analysis-queue';

import {
  registerAnalysisRoutes,
  type AnalysisApiDependencies,
  type AuthenticatedAnalysisPrincipal,
} from './modules/analysis/routes.js';
import { registerProductRoutes } from './modules/product/routes.js';
import type { ProductRouteDependencies } from './modules/product/routes.js';

export const serverName = 'bugzero-api';

export interface ApiServerOptions {
  authenticate(request: Parameters<AnalysisApiDependencies['authenticate']>[0]): Promise<AuthenticatedAnalysisPrincipal | null>;
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
  queue?: AnalysisApiDependencies['queue'];
  product?: Partial<Omit<ProductRouteDependencies, 'authenticate'>> & {
    authenticate?: ProductRouteDependencies['authenticate'];
  };
}

export function createApiServer(options: ApiServerOptions): FastifyInstance {
  const server = Fastify({ logger: true });
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
    const errorName = error instanceof Error ? error.name : 'UnknownError';
    const candidateStatusCode = typeof error === 'object' && error !== null
      && 'statusCode' in error && typeof error.statusCode === 'number'
      ? error.statusCode
      : null;
    request.log.error({ errorName, statusCode: candidateStatusCode }, 'Unhandled API request error');
    const statusCode = candidateStatusCode !== null && candidateStatusCode >= 400 && candidateStatusCode < 500
      ? candidateStatusCode
      : 500;
    return reply.code(statusCode).send({
      error: statusCode === 500 ? 'Internal server error' : 'Request could not be completed',
      code: statusCode === 500 ? 'INTERNAL_ERROR' : 'REQUEST_ERROR',
    });
  });
  let publisher = options.queue;

  if (!publisher) {
    const redisConnection = new Redis(getRedisUrl(), { maxRetriesPerRequest: null });
    const queue = createAnalysisQueue(redisConnection);
    publisher = {
      async enqueue(payload: AnalysisQueuePayload): Promise<void> {
        await enqueueAnalysisJob(queue, payload);
      },
    };
    server.addHook('onClose', async () => {
      await queue.close();
      await redisConnection.quit();
    });
  }

  registerAnalysisRoutes(server, {
    authenticate,
    analysis: options.analysis ?? analysisRepository,
    repositories: options.repositories ?? repositoriesRepository,
    commits: options.commits ?? commitsRepository,
    members: options.members ?? membersRepository,
    queue: publisher,
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
    github: options.product?.github ?? new GitHubRepositoryProvider({ token: process.env.GITHUB_TOKEN }),
  });
  return server;
}

export async function startApiServer(options: ApiServerOptions, port = Number(process.env.PORT ?? '3001')): Promise<FastifyInstance> {
  const server = createApiServer(options);
  await server.listen({ host: process.env.HOST ?? '0.0.0.0', port });
  return server;
}
