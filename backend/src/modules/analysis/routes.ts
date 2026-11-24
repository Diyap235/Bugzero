import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  AcceptedAnalysisSchema,
  AnalysisRunStatusResponseSchema,
  AnalyzerType,
  CreateAnalysisRequestSchema,
} from '@bugzero/contracts';
import { defaultAnalysisProfile } from '@bugzero/config';
import type {
  AnalysisJobType,
  AnalysisRepository,
  CommitRepository,
  MemberRepository,
  RepositoryRepository,
} from '@bugzero/database';

export interface AuthenticatedAnalysisPrincipal {
  userId: string;
  organizationId: string;
}

export interface AnalysisApiDependencies {
  authenticate(request: FastifyRequest): Promise<AuthenticatedAnalysisPrincipal | null>;
  analysis: Pick<
    AnalysisRepository,
    | 'ensureDefaultProfile'
    | 'getLatestProfile'
    | 'createOrGetActiveWork'
    | 'getRun'
    | 'getLatestJobForRun'
    | 'updateJobStatus'
    | 'updateRunStatus'
  >;
  repositories: Pick<RepositoryRepository, 'getById'>;
  commits: Pick<CommitRepository, 'getByCommitSha'>;
  members: Pick<MemberRepository, 'getMembership'>;
}

const ANALYSIS_REQUEST_ROLES = new Set(['OWNER', 'ADMIN', 'DEVELOPER', 'SECURITY_REVIEWER']);

function toIsoTimestamp(value: string): string;
function toIsoTimestamp(value: string | null): string | null;
function toIsoTimestamp(value: string | Date | null): string | null {
  return value instanceof Date ? value.toISOString() : value;
}

export function registerAnalysisRoutes(server: FastifyInstance, dependencies: AnalysisApiDependencies): void {
  server.post('/analysis', async (request, reply) => {
    const requestStartedAt = Date.now();
    const principal = await dependencies.authenticate(request);
    if (!principal) return reply.code(401).send({ error: 'Authentication required' });

    const membership = await dependencies.members.getMembership(principal.organizationId, principal.userId);
    if (!membership) return reply.code(403).send({ error: 'Organization membership required' });
    if (!ANALYSIS_REQUEST_ROLES.has(membership.role)) {
      return reply.code(403).send({ error: 'Insufficient role to request repository analysis' });
    }

    const parsedRequest = CreateAnalysisRequestSchema.safeParse(request.body);
    if (!parsedRequest.success) {
      return reply.code(400).send({ error: 'Invalid analysis request', details: parsedRequest.error.flatten() });
    }
    const body = parsedRequest.data;
    const [repository, commit] = await Promise.all([
      dependencies.repositories.getById(principal.organizationId, body.repositoryId),
      dependencies.commits.getByCommitSha(
        principal.organizationId,
        body.repositoryId,
        body.commitSha,
      ),
    ]);
    if (!repository) return reply.code(404).send({ error: 'Repository not found' });
    if (!commit) return reply.code(404).send({ error: 'Commit is not indexed for this repository' });

    const profile = body.profileId === 'default'
      ? await dependencies.analysis.ensureDefaultProfile(principal.organizationId)
      : await dependencies.analysis.getLatestProfile(principal.organizationId, body.profileId);
    if (!profile) return reply.code(404).send({ error: 'Analysis profile not found' });

    const analyzers = profile.analyzers
      .filter((entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null)
      .map((entry) => ({
        name: typeof entry.name === 'string' ? entry.name : null,
        type: AnalyzerType.safeParse(entry.type),
      }))
      .filter((entry): entry is { name: string; type: { success: true; data: AnalysisJobType } } =>
        entry.name !== null && entry.type.success,
      );
    const analyzer = analyzers[0];
    const defaultAnalyzer = defaultAnalysisProfile.analyzers[0];
    if (
      analyzers.length !== 1
      || profile.analyzers.length !== 1
      || !analyzer
      || analyzer.name !== defaultAnalyzer.name
      || !analyzer.type.success
      || analyzer.type.data !== defaultAnalyzer.type
    ) {
      return reply.code(409).send({ error: 'Analysis profile contains analyzer configuration unsupported by the current worker' });
    }

    const fileIds = Array.from(new Set(body.changedFiles)).sort();
    const changedEntityIds = Array.from(new Set(body.changedEntityIds)).sort();
    const scopeKey = JSON.stringify({
      mode: body.scope,
      fileIds,
      changedEntityIds,
    });
    const idempotencyIdentity = JSON.stringify({
      organizationId: principal.organizationId,
      repositoryId: repository.id,
      commitId: commit.id,
      profileId: profile.id,
      profileVersion: profile.version,
      scope: body.scope,
      scopeKey,
    });
    const idempotencyKey = createHash('sha256').update(idempotencyIdentity).digest('hex');
    const work = await dependencies.analysis.createOrGetActiveWork({
      organizationId: principal.organizationId,
      repositoryId: repository.id,
      commitId: commit.id,
      profileId: profile.id,
      profileVersion: profile.version,
      scope: body.scope,
      analyzer: analyzer.name,
      analyzerType: analyzer.type.data,
      scopeKey,
      idempotencyKey,
    });

    request.log.info({
      requestId: request.id,
      analysisRunId: work.run.id,
      jobId: work.job.id,
      availableForWorker: work.job.status === 'QUEUED' || work.job.status === 'RETRY',
      reused: !work.created,
      durationMs: Date.now() - requestStartedAt,
    }, 'Analysis requested');
    return reply.code(202).send(AcceptedAnalysisSchema.parse({
      analysisRunId: work.run.id,
      jobId: work.job.id,
      status: work.job.status,
    }));
  });

  server.get<{ Params: { runId: string } }>('/analysis/:runId', async (request, reply) => {
    const requestStartedAt = Date.now();
    const principal = await dependencies.authenticate(request);
    if (!principal) return reply.code(401).send({ error: 'Authentication required' });

    const [membership, run, job] = await Promise.all([
      dependencies.members.getMembership(principal.organizationId, principal.userId),
      dependencies.analysis.getRun(principal.organizationId, request.params.runId),
      dependencies.analysis.getLatestJobForRun(principal.organizationId, request.params.runId),
    ]);
    if (!membership) return reply.code(403).send({ error: 'Organization membership required' });

    if (!run) return reply.code(404).send({ error: 'Analysis run not found' });
    const pipeline = run.coverage.pipeline;
    const rawProgress = typeof pipeline === 'object' && pipeline !== null
      ? pipeline as Record<string, unknown>
      : {};
    const analyzerProgress = Array.isArray(rawProgress.analyzers)
      ? rawProgress.analyzers.map((entry) => {
        if (typeof entry !== 'object' || entry === null) return {};
        const analyzer = entry as Record<string, unknown>;
        return { status: analyzer.status, metrics: analyzer.metrics, diagnostics: analyzer.diagnostics };
      })
      : [];
    const progress: Record<string, unknown> = {
      status: rawProgress.status,
      sourceFiles: rawProgress.sourceFiles,
      parsedFiles: rawProgress.parsedFiles,
      persistedEntities: rawProgress.persistedEntities,
      irEntityCount: rawProgress.irEntityCount,
      irRelationshipCount: rawProgress.irRelationshipCount,
      persistedRelationshipCount: rawProgress.persistedRelationshipCount,
      parsingDurationMs: rawProgress.parsingDurationMs,
      intelligenceStatus: rawProgress.intelligenceStatus,
      intelligenceDurationMs: rawProgress.intelligenceDurationMs,
      findings: rawProgress.findings,
      analyzers: analyzerProgress,
      parseDiagnostics: rawProgress.parseDiagnostics,
      budgetDiagnostics: rawProgress.budgetDiagnostics,
      resourceBudget: rawProgress.resourceBudget,
      timings: rawProgress.timings,
      evidence: rawProgress.evidence,
      risk: rawProgress.risk,
      mlSignals: rawProgress.mlSignals,
      health: rawProgress.health,
      aiReview: rawProgress.aiReview,
      aiInvestigation: rawProgress.aiInvestigation,
    };
    for (const key of Object.keys(progress)) {
      if (progress[key] === undefined) delete progress[key];
    }
    const response = AnalysisRunStatusResponseSchema.parse({
      analysisRunId: run.id,
      status: run.status,
      job: job ? {
        id: job.id,
        status: job.status,
        stage: job.stage,
        attempt: job.attempt,
        createdAt: toIsoTimestamp(job.created_at),
        startedAt: toIsoTimestamp(job.started_at),
        finishedAt: toIsoTimestamp(job.finished_at),
      } : null,
      progress,
      failure: run.status === 'FAILED' ? 'Analysis failed; consult operational logs for details' : null,
      startedAt: toIsoTimestamp(run.started_at),
      completedAt: toIsoTimestamp(run.completed_at),
    });
    request.log.info({
      requestId: request.id,
      analysisRunId: run.id,
      jobId: job?.id ?? null,
      status: run.status,
      stage: job?.stage ?? null,
      durationMs: Date.now() - requestStartedAt,
    }, 'Analysis status returned');
    return reply.send(response);
  });
}
