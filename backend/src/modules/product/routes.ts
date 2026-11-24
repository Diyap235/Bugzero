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
import {
  AIInvestigationRecordSchema,
  CreateReportRequestSchema,
  ReportDocumentSchema,
  ReportDocumentResponseSchema,
  ReportListResponseSchema,
} from '@bugzero/contracts';
import type { AuthenticatedAnalysisPrincipal } from '../analysis/routes.js';

export type ProductRouteDependencies = {
  authenticate(request: FastifyRequest): Promise<AuthenticatedAnalysisPrincipal | null>;
  members: Pick<MemberRepository, 'getMembership'>;
  repositories: Pick<RepositoryRepository, 'getById' | 'listByOrganization'>;
  commits: Pick<CommitRepository, 'getLatest' | 'getById'>
    & Partial<Pick<CommitRepository, 'getByIds'>>;
  analysis: Pick<AnalysisRepository, 'listRunsByRepository' | 'getLatestJobForRun'>
    & Partial<Pick<AnalysisRepository, 'getRun'>>;
  findings: Pick<FindingRepository, 'getByRepository' | 'getById' | 'getOccurrencesForFinding'>
    & Partial<Pick<FindingRepository, 'getOccurrencesForFindings'>>;
  evidence: Pick<EvidenceRepository, 'getEvidenceForFinding' | 'getSnapshot'>;
  risks: Pick<RiskAssessmentRepository, 'getForFinding'>;
  health: Pick<HealthRepository, 'getForRun' | 'listByRepository'>;
  reports: Pick<ReportRepository, 'listByRepository'>
    & Partial<Pick<ReportRepository, 'createOrGetReport' | 'getById' | 'saveDocument'>>;
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

function currentRiskNumber(value: number | string | null): number | null {
  if (value === null) return null;
  if (typeof value === 'string' && value.trim() === '') {
    throw new Error('Persisted finding risk must be a number between 0 and 100');
  }
  const risk = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(risk) || risk < 0 || risk > 100) {
    throw new Error('Persisted finding risk must be a number between 0 and 100');
  }
  return risk;
}

function persistedScore(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const score = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(score) || score < 0 || score > 100) {
    throw new Error('Persisted report score must be null or a number between 0 and 100');
  }
  return score;
}

function reportDate(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('Persisted report timestamp is invalid');
  return date.toISOString();
}

function reportSummary(record: Awaited<ReturnType<ProductRouteDependencies['reports']['listByRepository']>>[number]) {
  const { report: _document, ...summaryMetadata } = record.metadata;
  return {
    id: record.id,
    organizationId: record.organization_id,
    repositoryId: record.repository_id,
    analysisRunId: record.analysis_run_id,
    createdByUserId: record.created_by_user_id,
    format: record.format,
    metadata: summaryMetadata,
    createdAt: reportDate(record.created_at),
  };
}

async function buildReportDocument(
  repository: NonNullable<Awaited<ReturnType<ProductRouteDependencies['repositories']['getById']>>>,
  run: Awaited<ReturnType<ProductRouteDependencies['analysis']['listRunsByRepository']>>[number],
  principal: AuthenticatedAnalysisPrincipal,
  dependencies: ProductRouteDependencies,
  reportId: string,
) {
  const [commit, findings, health] = await Promise.all([
    dependencies.commits.getById(principal.organizationId, repository.id, run.commit_id),
    dependencies.findings.getByRepository(principal.organizationId, repository.id),
    dependencies.health.getForRun(principal.organizationId, repository.id, run.id),
  ]);
  const items = (await Promise.all(findings.map(async (finding) => {
    const occurrences = await dependencies.findings.getOccurrencesForFinding(principal.organizationId, finding.id);
    const occurrence = occurrences.find((candidate) =>
      candidate.analysis_run_id === run.id && candidate.observation === 'DETECTED');
    if (!occurrence) return null;
    const [evidenceRecords, investigations] = await Promise.all([
      dependencies.evidence.getEvidenceForFinding(principal.organizationId, finding.id),
      dependencies.aiInvestigations.getForOccurrence(principal.organizationId, occurrence.id),
    ]);
    const relevantEvidence = evidenceRecords.filter((evidence) =>
      evidence.finding_occurrence_id === occurrence.id && evidence.analysis_run_id === run.id);
    const evidenceGraphs = await Promise.all(relevantEvidence.map((evidence) =>
      dependencies.evidence.getSnapshot(principal.organizationId, evidence.id)));
    const authoritativeEvidence = relevantEvidence.some((evidence) => evidence.authority === 'AUTHORITATIVE');
    const investigativeEvidence = relevantEvidence.some((evidence) => evidence.authority === 'INVESTIGATIVE');
    const estimate = investigations.find((item) => item.status === 'COMPLETED' && item.result)?.result ?? null;
    const evidenceText = relevantEvidence.flatMap((evidence, index) => {
      const graph = evidenceGraphs[index];
      return [
        `Evidence ${evidence.authority.toLowerCase()} (${evidence.origin.toLowerCase()}, ${evidence.completeness.toLowerCase()}, ${evidence.sufficiency.toLowerCase()} sufficiency)`,
        ...evidence.diagnostics.map((diagnostic) => `Diagnostic: ${diagnostic}`),
        ...(graph?.nodes ?? []).map((node) =>
          `${node.label}${node.file_path ? ` — ${node.file_path}${node.line ? `:${node.line}` : ''}` : ''}`),
        ...(graph?.edges ?? []).map((edge) =>
          `${edge.relation} (${edge.resolution.toLowerCase()}, ${edge.confidence.toLowerCase()} confidence)`),
      ];
    });
    const completeness = relevantEvidence.some((evidence) => evidence.completeness === 'INCOMPLETE')
      ? 'INCOMPLETE'
      : relevantEvidence.some((evidence) => evidence.completeness === 'PARTIAL')
        ? 'PARTIAL'
        : relevantEvidence.length > 0 ? 'COMPLETE' : 'UNKNOWN';
    return {
      findingId: finding.id,
      ruleId: occurrence.rule_id,
      title: ruleTitle(occurrence.rule_id),
      description: null,
      severity: occurrence.severity,
      confidence: occurrence.confidence,
      lifecycle: finding.lifecycle,
      filePath: occurrence.file_path,
      startLine: occurrence.start_line,
      endLine: occurrence.end_line,
      evidenceAuthority: authoritativeEvidence ? 'AUTHORITATIVE' as const
        : investigativeEvidence ? 'INVESTIGATIVE' as const : 'UNKNOWN' as const,
      evidenceStatus: completeness,
      evidence: evidenceText.length > 0 ? evidenceText : ['Evidence details were not persisted for this finding.'],
      investigativeEstimate: estimate ? {
        summary: estimate.summary,
        explanation: estimate.explanation,
        remediation: estimate.remediation,
        confidence: estimate.confidence,
        reasoningStatus: estimate.reasoningStatus,
      } : null,
    };
  }))).filter((item): item is NonNullable<typeof item> => item !== null);
  const security = items.filter((item) => item.ruleId.startsWith('SECURITY.'));
  const codeQuality = items.filter((item) => !item.ruleId.startsWith('SECURITY.'));
  const bySeverity = {
    INFO: 0,
    LOW: 0,
    MEDIUM: 0,
    HIGH: 0,
    CRITICAL: 0,
  };
  for (const item of items) bySeverity[item.severity] += 1;
  const status = health?.coverage ?? 'UNKNOWN';
  const dimension = (value: number | null | undefined) => ({
    status: value === null || value === undefined ? 'UNKNOWN' : status,
    score: persistedScore(value),
  });
  const recommendations = security.map((finding) => ({
    text: finding.investigativeEstimate?.remediation[0]
      ?? (finding.ruleId === 'SECURITY.SQL_INJECTION'
        ? 'Replace dynamically constructed SQL with parameterized queries and validate the data flow to the SQL sink.'
        : 'Review this security finding and apply a targeted remediation based on the persisted evidence.'),
    basis: `Finding ${finding.findingId} (${finding.ruleId})${finding.investigativeEstimate ? '; advisory text is an AI investigative estimate.' : '; grounded in the deterministic rule identifier.'}`,
    authority: finding.investigativeEstimate ? 'INVESTIGATIVE' as const : 'AUTHORITATIVE' as const,
  }));
  const qualityRecommendations = codeQuality.map((finding) => ({
    text: finding.investigativeEstimate?.remediation[0]
      ?? `Review ${finding.title.toLowerCase()} at ${finding.filePath ?? 'the reported location'} and address the recorded structural-quality concern.`,
    basis: `Finding ${finding.findingId} (${finding.ruleId})`,
    authority: finding.investigativeEstimate ? 'INVESTIGATIVE' as const : 'AUTHORITATIVE' as const,
  }));
  const analysisTime = run.completed_at ?? run.created_at;
  return ReportDocumentSchema.parse({
    id: reportId,
    repository: { id: repository.id, name: repository.full_name },
    analysis: {
      runId: run.id,
      status: run.status,
      scope: run.scope,
      commitSha: commit?.commit_sha ?? null,
      createdAt: reportDate(run.created_at),
      completedAt: run.completed_at ? reportDate(run.completed_at) : null,
      coverage: run.coverage,
    },
    executiveSummary: `${repository.full_name} analysis ${run.status.toLowerCase()} on ${analysisTime}. ${security.length} security finding(s) and ${codeQuality.length} code-quality finding(s) were recorded for this analysis run. Health dimensions without persisted measurements are labeled Unknown; ${run.status === 'PARTIAL' ? 'this analysis is partial.' : 'findings are limited to recorded analysis evidence.'}`,
    findings: {
      total: items.length,
      bySeverity,
      security,
      codeQuality,
    },
    results: {
      quality: dimension(health?.quality_score),
      maintainability: dimension(health?.maintainability_score),
      reliability: dimension(health?.reliability_score),
      dependencies: dimension(health?.dependency_score),
      coverage: {
        status: health?.coverage ?? 'UNKNOWN',
        details: run.coverage,
      },
    },
    recommendations: [...recommendations, ...qualityRecommendations],
    evidencePolicy: {
      authoritative: 'Deterministic analyzer evidence and persisted risk records are the authoritative basis for findings. Health scores are included only when persisted for this analysis.',
      investigative: 'AI-generated explanations and remediation are advisory investigative estimates, are labeled as such, and do not change finding severity or authority.',
    },
  });
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
    const [commit, runs, findings] = await Promise.all([
      dependencies.commits.getLatest(principal.organizationId, repository.id),
      dependencies.analysis.listRunsByRepository(principal.organizationId, repository.id),
      dependencies.findings.getByRepository(principal.organizationId, repository.id),
    ]);
    const latestRun = runs[0] ?? null;
    const [latestJob, latestHealth] = latestRun
      ? await Promise.all([
        dependencies.analysis.getLatestJobForRun(principal.organizationId, latestRun.id),
        dependencies.health.getForRun(principal.organizationId, repository.id, latestRun.id),
      ])
      : [null, null];
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
        highRisk: findings.filter((finding) => {
          const currentRisk = currentRiskNumber(finding.current_risk);
          return currentRisk !== null && currentRisk >= 70
            && !['RESOLVED', 'DISMISSED'].includes(finding.lifecycle);
        }).length,
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
          occurrence.analysis_run_id === run.id)
          .map((occurrence) => occurrence.id));
      const totalTechnicalRisk = findingData.flatMap(({ risks }) => risks)
        .filter((assessment) => assessment.analysis_run_id === run.id)
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
    const occurrences = dependencies.findings.getOccurrencesForFindings
      ? await dependencies.findings.getOccurrencesForFindings(
        principal.organizationId,
        records.map((finding) => finding.id),
      )
      : (await Promise.all(records.map((finding) =>
        dependencies.findings.getOccurrencesForFinding(principal.organizationId, finding.id)))).flat();
    const occurrencesByFinding = new Map<string, typeof occurrences>();
    for (const occurrence of occurrences) {
      const current = occurrencesByFinding.get(occurrence.finding_id) ?? [];
      current.push(occurrence);
      occurrencesByFinding.set(occurrence.finding_id, current);
    }
    const commitIds = [...new Set(occurrences.map((occurrence) => occurrence.commit_id))];
    const commits = dependencies.commits.getByIds
      ? await dependencies.commits.getByIds(principal.organizationId, repository.id, commitIds)
      : (await Promise.all(commitIds.map((commitId) =>
        dependencies.commits.getById(principal.organizationId, repository.id, commitId))))
        .filter((commit): commit is NonNullable<typeof commit> => commit !== null);
    const commitShaById = new Map(commits.map((commit) => [commit.id, commit.commit_sha]));
    const findings = records.map((finding) => {
      const findingOccurrences = occurrencesByFinding.get(finding.id) ?? [];
      const occurrence = findingOccurrences.find((item) => item.id === finding.current_occurrence_id)
        ?? findingOccurrences[0]
        ?? null;
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
          currentRisk: currentRiskNumber(finding.current_risk),
          lastSeenRevision: occurrence ? commitShaById.get(occurrence.commit_id) ?? null : null,
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
          commitSha: commitShaById.get(occurrence.commit_id) ?? null,
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
    });
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
      .filter((record) => record.evidence_id === evidenceRecord?.id)
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
      }))
      .map(({ id, status, result, errorCode, createdAt, updatedAt }) => ({
        id,
        status,
        result,
        errorCode,
        createdAt,
        updatedAt,
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
    const aiInvestigation = aiInvestigations.find((record) => record.status === 'COMPLETED')
      ?? aiInvestigations[0]
      ?? null;
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
        currentRisk: currentRiskNumber(finding.current_risk),
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
    const [snapshots, runs] = await Promise.all([
      dependencies.health.listByRepository(principal.organizationId, repository.id),
      dependencies.analysis.listRunsByRepository(principal.organizationId, repository.id),
    ]);
    const history = await Promise.all(snapshots.map(async (snapshot) => {
      const commit = await dependencies.commits.getById(principal.organizationId, repository.id, snapshot.commit_id);
      const run = runs.find((candidate) => candidate.id === snapshot.analysis_run_id);
      return {
        snapshot,
        commitSha: commit?.commit_sha ?? null,
        analysisRunStatus: run?.status ?? null,
      };
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
      reports: reports.map(reportSummary),
    }));
  });

  server.post<{ Params: { repositoryId: string }; Body: unknown }>(
    '/repositories/:repositoryId/reports',
    async (request, reply) => {
      const principal = await authorize(request, reply, dependencies);
      if (!principal) return;
      const parsed = CreateReportRequestSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'A valid completed analysisRunId is required' });
      const repository = await dependencies.repositories.getById(principal.organizationId, request.params.repositoryId);
      if (!repository) return reply.code(404).send({ error: 'Repository not found' });
      const run = dependencies.analysis.getRun
        ? await dependencies.analysis.getRun(principal.organizationId, parsed.data.analysisRunId)
        : (await dependencies.analysis.listRunsByRepository(principal.organizationId, repository.id))
          .find((candidate) => candidate.id === parsed.data.analysisRunId) ?? null;
      if (!run || run.repository_id !== repository.id) {
        return reply.code(404).send({ error: 'Analysis run not found for this repository' });
      }
      if (run.status !== 'COMPLETED' && run.status !== 'PARTIAL') {
        return reply.code(409).send({ error: 'A completed or partial analysis is required to generate a report' });
      }
      if (!dependencies.reports.createOrGetReport || !dependencies.reports.saveDocument) {
        return reply.code(503).send({ error: 'Report generation is unavailable' });
      }
      const { record, created } = await dependencies.reports.createOrGetReport({
        organizationId: principal.organizationId,
        repositoryId: repository.id,
        analysisRunId: run.id,
        createdByUserId: principal.userId,
        format: 'JSON',
        metadata: { title: `Analysis report — ${repository.full_name}` },
      });
      const report = record.metadata.report
        ? ReportDocumentSchema.parse(record.metadata.report)
        : await buildReportDocument(repository, run, principal, dependencies, record.id);
      if (!record.metadata.report) await dependencies.reports.saveDocument(
        principal.organizationId,
        record.id,
        report,
      );
      return reply.code(created ? 201 : 200).send(ReportDocumentResponseSchema.parse({ report }));
    },
  );

  server.get<{ Params: { reportId: string } }>('/reports/:reportId', async (request, reply) => {
    const principal = await authorize(request, reply, dependencies);
    if (!principal) return;
    if (!dependencies.reports.getById) return reply.code(503).send({ error: 'Report retrieval is unavailable' });
    const record = await dependencies.reports.getById(principal.organizationId, request.params.reportId);
    if (!record?.metadata.report) return reply.code(404).send({ error: 'Report not found' });
    return reply.send(ReportDocumentResponseSchema.parse({ report: record.metadata.report }));
  });
}
