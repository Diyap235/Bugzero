import type { FastifyInstance, FastifyRequest } from 'fastify';
import type {
  AnalysisRepository,
  AIInvestigationRepository,
  CommitRepository,
  EvidenceRepository,
  FindingRepository,
  HealthRepository,
  MemberRepository,
  ReportRepository,
  RepositoryRepository,
  RiskAssessmentRepository,
} from '@bugzero/database';
import { AIInvestigationRecordSchema, ReportListResponseSchema } from '@bugzero/contracts';
import type { AuthenticatedAnalysisPrincipal } from '../analysis/routes.js';

export type ProductRouteDependencies = {
  authenticate(request: FastifyRequest): Promise<AuthenticatedAnalysisPrincipal | null>;
  members: Pick<MemberRepository, 'getMembership'>;
  repositories: Pick<RepositoryRepository, 'getById' | 'listByOrganization'>;
  commits: Pick<CommitRepository, 'getLatest' | 'getById'>;
  analysis: Pick<AnalysisRepository, 'listRunsByRepository' | 'getLatestJobForRun'>;
  findings: Pick<FindingRepository, 'getByRepository' | 'getById' | 'getOccurrencesForFinding'>;
  evidence: Pick<EvidenceRepository, 'getEvidenceForFinding' | 'getSnapshot'>;
  risks: Pick<RiskAssessmentRepository, 'getForFinding'>;
  health: Pick<HealthRepository, 'getLatest' | 'listByRepository'>;
  reports: Pick<ReportRepository, 'listByRepository'>;
  aiInvestigations: Pick<AIInvestigationRepository, 'getForOccurrence'>;
};

async function authorize(
  request: FastifyRequest,
  reply: { code(statusCode: number): { send(payload: unknown): unknown } },
  dependencies: ProductRouteDependencies,
): Promise<AuthenticatedAnalysisPrincipal | null> {
  const principal = await dependencies.authenticate(request);
  if (!principal) {
    reply.code(401).send({ error: 'Authentication required' });
    return null;
  }
  const membership = await dependencies.members.getMembership(principal.organizationId, principal.userId);
  if (!membership) {
    reply.code(403).send({ error: 'Organization membership required' });
    return null;
  }
  return principal;
}

function camelRepository(repository: NonNullable<Awaited<ReturnType<ProductRouteDependencies['repositories']['getById']>>>) {
  return {
    id: repository.id,
    organizationId: repository.organization_id,
    provider: repository.provider,
    externalId: repository.external_id,
    fullName: repository.full_name,
    defaultBranch: repository.default_branch,
    cloneUrl: repository.clone_url,
    createdAt: repository.created_at,
    updatedAt: repository.updated_at,
  };
}

function camelCommit(commit: NonNullable<Awaited<ReturnType<ProductRouteDependencies['commits']['getLatest']>>>) {
  return {
    id: commit.id,
    organizationId: commit.organization_id,
    repositoryId: commit.repository_id,
    commitSha: commit.commit_sha,
    parentCommitSha: commit.parent_commit_sha,
    createdAt: commit.created_at,
    indexedAt: commit.indexed_at,
  };
}

function camelRun(run: Awaited<ReturnType<ProductRouteDependencies['analysis']['listRunsByRepository']>>[number]) {
  return {
    id: run.id,
    organizationId: run.organization_id,
    repositoryId: run.repository_id,
    commitId: run.commit_id,
    commitSha: null as string | null,
    profileId: run.profile_id,
    profileVersion: run.profile_version,
    scope: run.scope,
    status: run.status,
    createdAt: run.created_at,
    startedAt: run.started_at,
    completedAt: run.completed_at,
    coverage: run.coverage,
  };
}

function ruleTitle(ruleId: string): string {
  if (ruleId === 'SECURITY.SQL_INJECTION') return 'SQL Injection';
  const title = ruleId.split('.').at(-1)?.replaceAll('_', ' ') ?? ruleId;
  return title.replace(/\b\w/g, (character) => character.toUpperCase());
}

function runPipeline(
  runs: Awaited<ReturnType<ProductRouteDependencies['analysis']['listRunsByRepository']>>,
  runId: string,
): Record<string, unknown> | null {
  const run = runs.find((candidate) => candidate.id === runId);
  const coverage = run?.coverage;
  if (typeof coverage !== 'object' || coverage === null) return null;
  const pipeline = coverage.pipeline;
  return typeof pipeline === 'object' && pipeline !== null
    ? pipeline as Record<string, unknown>
    : null;
}

function runMLReport(
  runs: Awaited<ReturnType<ProductRouteDependencies['analysis']['listRunsByRepository']>>,
  runId: string,
): Record<string, unknown> | null {
  const report = runPipeline(runs, runId)?.mlSignals;
  return typeof report === 'object' && report !== null ? report as Record<string, unknown> : null;
}

function runAIInvestigationStatus(
  runs: Awaited<ReturnType<ProductRouteDependencies['analysis']['listRunsByRepository']>>,
  runId: string,
): 'NOT_REQUESTED' | 'UNAVAILABLE' | 'COMPLETED' | 'PARTIAL' | 'FAILED' | null {
  const summary = runPipeline(runs, runId)?.aiInvestigation;
  if (typeof summary !== 'object' || summary === null || !('status' in summary)) return null;
  const status = summary.status;
  return status === 'NOT_REQUESTED' || status === 'UNAVAILABLE' || status === 'COMPLETED'
    || status === 'PARTIAL' || status === 'FAILED'
    ? status
    : null;
}

function matchingMLSignal(
  report: Record<string, unknown> | null,
  filePath: string | null,
  startLine: number | null,
  endLine: number | null,
): Record<string, unknown> | null {
  if (!report || report.status !== 'AVAILABLE' || !filePath || !Array.isArray(report.signals)) return null;
  const match = report.signals.find((candidate: unknown) => {
    if (typeof candidate !== 'object' || candidate === null || !('function' in candidate)) return false;
    const signal = candidate as Record<string, unknown>;
    const fn = signal.function;
    if (typeof fn !== 'object' || fn === null) return false;
    const functionRef = fn as Record<string, unknown>;
    if (
      functionRef.filePath !== filePath
      || typeof signal.modelVersion !== 'string'
      || (signal.label !== 'safe' && signal.label !== 'vulnerable')
      || typeof signal.score !== 'number'
      || !Number.isFinite(signal.score)
      || signal.score < 0
      || signal.score > 1
    ) return false;
    const functionStart = functionRef.startLine;
    const functionEnd = functionRef.endLine;
    return typeof functionStart === 'number' && typeof functionEnd === 'number'
      && (startLine === null || functionEnd >= startLine)
      && (endLine === null || functionStart <= endLine);
  });
  if (!match || typeof match !== 'object' || match === null) return null;
  const signal = match as Record<string, unknown>;
  const fn = signal.function as Record<string, unknown>;
  return {
    classification: 'INVESTIGATIVE',
    modelVersion: signal.modelVersion,
    label: signal.label,
    score: signal.score,
    timestamp: typeof signal.timestamp === 'string' ? signal.timestamp : null,
    function: {
      functionName: typeof fn.functionName === 'string' ? fn.functionName : null,
      filePath: String(fn.filePath),
      startLine: Number(fn.startLine),
      endLine: Number(fn.endLine),
    },
  };
}

export function registerProductRoutes(server: FastifyInstance, dependencies: ProductRouteDependencies): void {
  server.get('/repositories', async (request, reply) => {
    const principal = await authorize(request, reply, dependencies);
    if (!principal) return;
    const rows = await dependencies.repositories.listByOrganization(principal.organizationId);
    return reply.send({ repositories: rows.map(camelRepository) });
  });

  server.get<{ Params: { repositoryId: string } }>('/repositories/:repositoryId', async (request, reply) => {
    const principal = await authorize(request, reply, dependencies);
    if (!principal) return;
    const repository = await dependencies.repositories.getById(principal.organizationId, request.params.repositoryId);
    if (!repository) return reply.code(404).send({ error: 'Repository not found' });
    const [commit, runs, latestHealth, findings] = await Promise.all([
      dependencies.commits.getLatest(principal.organizationId, repository.id),
      dependencies.analysis.listRunsByRepository(principal.organizationId, repository.id),
      dependencies.health.getLatest(principal.organizationId, repository.id),
      dependencies.findings.getByRepository(principal.organizationId, repository.id),
    ]);
    const latestRun = runs[0] ?? null;
    const latestJob = latestRun
      ? await dependencies.analysis.getLatestJobForRun(principal.organizationId, latestRun.id)
      : null;
    return reply.send({
      repository: camelRepository(repository),
      latestCommit: commit ? camelCommit(commit) : null,
      latestRun: latestRun ? {
        ...camelRun(latestRun),
        job: latestJob ? {
          id: latestJob.id,
          status: latestJob.status,
          stage: latestJob.stage,
          attempt: latestJob.attempt,
          createdAt: latestJob.created_at,
          startedAt: latestJob.started_at,
          finishedAt: latestJob.finished_at,
        } : null,
      } : null,
      latestHealth,
      findingCounts: {
        total: findings.length,
        open: findings.filter((finding) => !['RESOLVED', 'DISMISSED'].includes(finding.lifecycle)).length,
        critical: findings.filter((finding) =>
          finding.current_severity === 'CRITICAL' && !['RESOLVED', 'DISMISSED'].includes(finding.lifecycle)).length,
        highRisk: findings.filter((finding) =>
          finding.current_risk >= 70 && !['RESOLVED', 'DISMISSED'].includes(finding.lifecycle)).length,
      },
    });
  });

  server.get<{ Params: { repositoryId: string } }>('/repositories/:repositoryId/history', async (request, reply) => {
    const principal = await authorize(request, reply, dependencies);
    if (!principal) return;
    const repository = await dependencies.repositories.getById(principal.organizationId, request.params.repositoryId);
    if (!repository) return reply.code(404).send({ error: 'Repository not found' });
    const [runs, findings, healthSnapshots] = await Promise.all([
      dependencies.analysis.listRunsByRepository(principal.organizationId, repository.id),
      dependencies.findings.getByRepository(principal.organizationId, repository.id),
      dependencies.health.listByRepository(principal.organizationId, repository.id),
    ]);
    const findingData = await Promise.all(findings.map(async (finding) => ({
      occurrences: await dependencies.findings.getOccurrencesForFinding(principal.organizationId, finding.id),
      risks: await dependencies.risks.getForFinding(principal.organizationId, finding.id),
    })));
    const history = await Promise.all(runs.map(async (run) => {
      const [job, commit] = await Promise.all([
        dependencies.analysis.getLatestJobForRun(principal.organizationId, run.id),
        dependencies.commits.getById(principal.organizationId, repository.id, run.commit_id),
      ]);
      const occurrenceIds = findingData.flatMap(({ occurrences }) =>
        occurrences.filter((occurrence) =>
          occurrence.analysis_run_id === run.id || occurrence.commit_id === run.commit_id)
          .map((occurrence) => occurrence.id));
      const totalTechnicalRisk = findingData.flatMap(({ risks }) => risks)
        .filter((assessment) => assessment.analysis_run_id === run.id || assessment.commit_id === run.commit_id)
        .reduce((total, assessment) => total + Number(assessment.technical_risk), 0);
      const healthSnapshot = healthSnapshots.find((snapshot) => snapshot.analysis_run_id === run.id)
        ?? healthSnapshots.find((snapshot) => snapshot.commit_id === run.commit_id);
      return {
        run: { ...camelRun(run), commitSha: commit?.commit_sha ?? null },
        job: job ? {
          id: job.id,
          status: job.status,
          stage: job.stage,
          attempt: job.attempt,
          createdAt: job.created_at,
          startedAt: job.started_at,
          finishedAt: job.finished_at,
        } : null,
        findingCount: occurrenceIds.length,
        totalTechnicalRisk,
        healthScore: healthSnapshot?.overall_score ?? null,
      };
    }));
    return reply.send({ history });
  });

  server.get<{ Params: { repositoryId: string } }>('/repositories/:repositoryId/findings', async (request, reply) => {
    const principal = await authorize(request, reply, dependencies);
    if (!principal) return;
    const repository = await dependencies.repositories.getById(principal.organizationId, request.params.repositoryId);
    if (!repository) return reply.code(404).send({ error: 'Repository not found' });
    const records = await dependencies.findings.getByRepository(principal.organizationId, repository.id);
    const findings = await Promise.all(records.map(async (finding) => {
      const occurrences = await dependencies.findings.getOccurrencesForFinding(principal.organizationId, finding.id);
      const occurrence = occurrences.find((item) => item.id === finding.current_occurrence_id) ?? occurrences[0] ?? null;
      const commit = occurrence
        ? await dependencies.commits.getById(principal.organizationId, repository.id, occurrence.commit_id)
        : null;
      return {
        finding: {
          id: finding.id,
          organizationId: finding.organization_id,
          repositoryId: finding.repository_id,
          ruleId: finding.rule_id,
          lifecycle: finding.lifecycle,
          currentOccurrenceId: finding.current_occurrence_id,
          resolutionEvidenceId: finding.resolution_evidence_id,
          currentSeverity: finding.current_severity,
          currentConfidence: finding.current_confidence,
          currentRisk: Number(finding.current_risk),
          lastSeenRevision: commit?.commit_sha ?? null,
          humanDisposition: {
            businessPriority: finding.business_priority,
            acceptedRisk: finding.accepted_risk,
            exceptionId: finding.exception_id,
            dispositionReason: finding.disposition_reason,
          },
          createdAt: finding.created_at,
          updatedAt: finding.updated_at,
        },
        occurrence: occurrence ? {
          id: occurrence.id,
          organizationId: occurrence.organization_id,
          findingId: occurrence.finding_id,
          repositoryId: occurrence.repository_id,
          commitId: occurrence.commit_id,
          analysisRunId: occurrence.analysis_run_id,
          commitSha: commit?.commit_sha ?? null,
          filePath: occurrence.file_path,
          startLine: occurrence.start_line,
          endLine: occurrence.end_line,
          observation: occurrence.observation,
          assessment: {
            severity: occurrence.severity,
            confidence: occurrence.confidence,
            evidenceStrength: occurrence.evidence_strength,
            exploitability: occurrence.exploitability,
            reachability: occurrence.reachability,
            technicalRisk: Number(occurrence.technical_risk),
          },
          fingerprint: {
            ruleId: occurrence.rule_id,
            semanticTargetId: occurrence.semantic_target_id,
            normalizedFingerprint: occurrence.normalized_fingerprint,
            relationshipFingerprint: occurrence.relationship_fingerprint,
          },
          resolution: occurrence.resolution,
          matchResult: occurrence.match_result,
          createdAt: occurrence.created_at,
        } : null,
      };
    }));
    return reply.send({ findings });
  });

  server.get<{ Params: { findingId: string } }>('/findings/:findingId', async (request, reply) => {
    const principal = await authorize(request, reply, dependencies);
    if (!principal) return;
    const finding = await dependencies.findings.getById(principal.organizationId, request.params.findingId);
    if (!finding) return reply.code(404).send({ error: 'Finding not found' });
    const [occurrences, evidenceRecords, riskRecords, runs] = await Promise.all([
      dependencies.findings.getOccurrencesForFinding(principal.organizationId, finding.id),
      dependencies.evidence.getEvidenceForFinding(principal.organizationId, finding.id),
      dependencies.risks.getForFinding(principal.organizationId, finding.id),
      dependencies.analysis.listRunsByRepository(principal.organizationId, finding.repository_id),
    ]);
    const occurrence = occurrences.find((item) => item.id === finding.current_occurrence_id) ?? occurrences[0] ?? null;
    const evidenceRecord = evidenceRecords.find((item) => item.finding_occurrence_id === occurrence?.id) ?? null;
    const evidenceGraph = evidenceRecord
      ? await dependencies.evidence.getSnapshot(principal.organizationId, evidenceRecord.id)
      : null;
    const aiRecords = occurrence
      ? await dependencies.aiInvestigations.getForOccurrence(principal.organizationId, occurrence.id)
      : [];
    const aiInvestigations = aiRecords
      .filter((record) => record.provider === 'GROQ' && record.evidence_id === evidenceRecord?.id)
      .map((record) => AIInvestigationRecordSchema.parse({
        id: record.id,
        provider: record.provider,
        model: record.model,
        promptVersion: record.prompt_version,
        status: record.status,
        result: record.result,
        errorCode: record.error_code,
        createdAt: new Date(record.created_at).toISOString(),
        updatedAt: new Date(record.updated_at).toISOString(),
      }));
    const risks = occurrence
      ? riskRecords.filter((item) => item.finding_occurrence_id === occurrence.id)
      : [];
    const selectedRisk = risks[0] ?? null;
    const mlReport = occurrence ? runMLReport(runs, occurrence.analysis_run_id) : null;
    const mlSignal = matchingMLSignal(
      mlReport,
      occurrence?.file_path ?? null,
      occurrence?.start_line ?? null,
      occurrence?.end_line ?? null,
    );
    const aiInvestigation = aiInvestigations[0] ?? null;
    const aiResult = aiInvestigation?.result ?? null;
    const aiInvestigationStatus = aiInvestigation?.status
      ?? (occurrence ? runAIInvestigationStatus(runs, occurrence.analysis_run_id) : null);
    const commit = occurrence
      ? await dependencies.commits.getById(principal.organizationId, finding.repository_id, occurrence.commit_id)
      : null;
    return reply.send({
      title: ruleTitle(finding.rule_id),
      description: occurrence?.observation ?? null,
      location: occurrence ? {
        filePath: occurrence.file_path,
        startLine: occurrence.start_line,
        endLine: occurrence.end_line,
      } : null,
      finding: {
        id: finding.id,
        organizationId: finding.organization_id,
        repositoryId: finding.repository_id,
        ruleId: finding.rule_id,
        lifecycle: finding.lifecycle,
        currentOccurrenceId: finding.current_occurrence_id,
        resolutionEvidenceId: finding.resolution_evidence_id,
        currentSeverity: finding.current_severity,
        currentConfidence: finding.current_confidence,
        currentRisk: Number(finding.current_risk),
        lastSeenRevision: commit?.commit_sha ?? null,
        humanDisposition: {
          businessPriority: finding.business_priority,
          acceptedRisk: finding.accepted_risk,
          exceptionId: finding.exception_id,
          dispositionReason: finding.disposition_reason,
        },
        createdAt: finding.created_at,
        updatedAt: finding.updated_at,
      },
      occurrence: occurrence ? {
        id: occurrence.id,
        organizationId: occurrence.organization_id,
        findingId: occurrence.finding_id,
        repositoryId: occurrence.repository_id,
        commitId: occurrence.commit_id,
        analysisRunId: occurrence.analysis_run_id,
        commitSha: commit?.commit_sha ?? null,
        filePath: occurrence.file_path,
        startLine: occurrence.start_line,
        endLine: occurrence.end_line,
        observation: occurrence.observation,
        assessment: {
          severity: occurrence.severity,
          confidence: occurrence.confidence,
          evidenceStrength: occurrence.evidence_strength,
          exploitability: occurrence.exploitability,
          reachability: occurrence.reachability,
          technicalRisk: Number(occurrence.technical_risk),
        },
        fingerprint: {
          ruleId: occurrence.rule_id,
          semanticTargetId: occurrence.semantic_target_id,
          normalizedFingerprint: occurrence.normalized_fingerprint,
          relationshipFingerprint: occurrence.relationship_fingerprint,
        },
        resolution: occurrence.resolution,
        matchResult: occurrence.match_result,
        createdAt: occurrence.created_at,
      } : null,
      evidence: evidenceGraph,
      risks,
      aiInvestigations,
      risk: selectedRisk,
      mlSignal,
      mlSignalStatus: mlReport && ['AVAILABLE', 'UNAVAILABLE', 'NOT_APPLICABLE'].includes(String(mlReport.status))
        ? mlReport.status
        : null,
      aiInvestigationStatus,
      aiExplanation: aiInvestigation ? {
        classification: 'EXPLANATORY',
        provider: aiInvestigation?.provider ?? null,
        model: aiInvestigation?.model ?? null,
        status: aiInvestigation?.status ?? null,
        summary: aiResult?.summary ?? null,
        explanation: aiResult?.explanation ?? null,
        attackPath: aiResult?.attackPath ?? [],
        reasoningStatus: aiResult?.reasoningStatus ?? null,
      } : null,
      recommendedFix: aiResult?.remediation ?? null,
    });
  });

  server.get<{ Params: { repositoryId: string } }>('/repositories/:repositoryId/health', async (request, reply) => {
    const principal = await authorize(request, reply, dependencies);
    if (!principal) return;
    const repository = await dependencies.repositories.getById(principal.organizationId, request.params.repositoryId);
    if (!repository) return reply.code(404).send({ error: 'Repository not found' });
    const snapshots = await dependencies.health.listByRepository(principal.organizationId, repository.id);
    const history = await Promise.all(snapshots.map(async (snapshot) => {
      const commit = await dependencies.commits.getById(principal.organizationId, repository.id, snapshot.commit_id);
      return { snapshot, commitSha: commit?.commit_sha ?? null };
    }));
    return reply.send({ history });
  });

  server.get<{ Params: { repositoryId: string } }>('/repositories/:repositoryId/reports', async (request, reply) => {
    const principal = await authorize(request, reply, dependencies);
    if (!principal) return;
    const repository = await dependencies.repositories.getById(principal.organizationId, request.params.repositoryId);
    if (!repository) return reply.code(404).send({ error: 'Repository not found' });
    const reports = await dependencies.reports.listByRepository(principal.organizationId, repository.id);
    return reply.send(ReportListResponseSchema.parse({
      reports: reports.map((report) => ({
        id: report.id,
        organizationId: report.organization_id,
        repositoryId: report.repository_id,
        analysisRunId: report.analysis_run_id,
        createdByUserId: report.created_by_user_id,
        format: report.format,
        metadata: report.metadata,
        createdAt: typeof report.created_at === 'string'
          ? new Date(report.created_at).toISOString()
          : report.created_at.toISOString(),
      })),
    }));
  });
}
