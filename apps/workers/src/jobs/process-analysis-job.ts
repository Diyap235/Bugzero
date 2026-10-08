import { createHash } from 'node:crypto';

import {
  analysisRepository,
  codeEntityRepository,
  codeRelationshipRepository,
  commitsRepository,
  repositoriesRepository,
  type AnalysisRepository,
  type AnalysisJob,
  type AnalysisRun,
  type CodeEntityRepository,
  type CodeRelationshipRecord,
  type CodeRelationshipRepository,
  type CommitRepository,
  type RepositoryRepository,
  type RepositoryRecord,
  type RepositoryCommit,
  type HealthRepository,
} from '@bugzero/database';

import { AnalyzerContext, type AnalysisScopeDefinition } from '../analyzers/analyzer-context.js';
import { analyzerOrchestrator, type AnalyzerOrchestrator } from '../analyzers/analyzer-orchestrator.js';
import { InMemorySourceAccess } from '../analyzers/source-access.js';
import type { AnalysisAttemptContext } from './analysis-queue.js';
import { ImpactAnalysisEngine } from '../intelligence/impact-analysis.js';
import { RepositoryIntelligenceBuilder } from '../intelligence/repository-intelligence-builder.js';
import { detectLanguageFromPath, isExcludedPath, isGeneratedFile, normalizeRepositoryRelativePath } from './ingest-repository.js';
import { normalizeLanguage, parseWithLanguageAdapter } from '../parser/language-adapters.js';
import { healthRepository } from '@bugzero/database';
import { repositoryHealthEngine } from '../health/health-engine.js';

const DEFAULT_ANALYSIS_RESOURCE_BUDGET = {
  maxFiles: 2_000,
  maxEntities: 20_000,
  maxDurationMs: 60_000,
} as const;

function logAnalysisEvent(event: string, context: Record<string, unknown>): void {
  console.info(JSON.stringify({ event, ...context }));
}

export interface AnalysisSourceFile {
  path: string;
  content: string;
}

export interface AnalysisSourceProvider {
  readCommit(repository: RepositoryRecord, commit: RepositoryCommit): Promise<AnalysisSourceFile[]>;
}

export class GitCommitSourceProvider implements AnalysisSourceProvider {
  constructor(
    private readonly config: {
      token?: string;
      fetchImpl?: typeof fetch;
      maxFiles?: number;
      maxFileBytes?: number;
      maxTotalBytes?: number;
      maxTreeResponseBytes?: number;
    } = {},
  ) {}

  private get fetchImpl(): typeof fetch {
    return this.config.fetchImpl ?? fetch;
  }

  async readCommit(repository: RepositoryRecord, commit: RepositoryCommit): Promise<AnalysisSourceFile[]> {
    const repositoryName = repository.full_name.split('/');
    if (
      repository.provider !== 'GITHUB'
      || repositoryName.length !== 2
      || !/^[A-Za-z0-9_.-]{1,39}$/.test(repositoryName[0])
      || !/^[A-Za-z0-9_.-]{1,100}$/.test(repositoryName[1])
      || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(commit.commit_sha)
    ) {
      throw new Error('Analysis source repository or commit metadata is invalid');
    }

    const [owner, name] = repositoryName;
    const apiRoot = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
    const treeResponse = await this.fetchImpl(`${apiRoot}/git/trees/${encodeURIComponent(commit.commit_sha)}?recursive=1`, {
      headers: this.headers,
      signal: AbortSignal.timeout(15_000),
    });
    if (!treeResponse.ok) throw new Error(`GitHub source tree request failed: ${treeResponse.status}`);
    const treeText = await this.readBoundedText(treeResponse, this.config.maxTreeResponseBytes ?? 8_000_000);
    const treePayload = JSON.parse(treeText) as {
      truncated?: boolean;
      tree?: Array<{ path?: string; type?: string; mode?: string; sha?: string; size?: number }>;
    };
    if (treePayload.truncated || !Array.isArray(treePayload.tree)) {
      throw new Error('GitHub source tree is incomplete or invalid');
    }

    const maxFiles = this.config.maxFiles ?? 2_000;
    const maxFileBytes = this.config.maxFileBytes ?? 1_000_000;
    const maxTotalBytes = this.config.maxTotalBytes ?? 10_000_000;
    const sourceEntries = treePayload.tree.filter((entry) =>
      entry.type === 'blob'
      && (entry.mode === '100644' || entry.mode === '100755')
      && typeof entry.path === 'string'
      && typeof entry.sha === 'string'
      && Number.isSafeInteger(entry.size)
      && (entry.size ?? -1) >= 0
      && !isExcludedPath(entry.path)
      && !isGeneratedFile(entry.path)
      && normalizeLanguage(detectLanguageFromPath(entry.path)) !== 'UNKNOWN');

    let totalBytes = 0;
    for (const entry of sourceEntries) {
      if ((entry.size ?? 0) > maxFileBytes) throw new Error('GitHub source file exceeds the per-file size limit');
      totalBytes += entry.size ?? 0;
      if (totalBytes > maxTotalBytes) throw new Error('GitHub source tree exceeds the total source size limit');
    }
    if (sourceEntries.length > maxFiles) throw new Error('GitHub source tree exceeds the source file-count limit');

    const files: AnalysisSourceFile[] = [];
    for (let start = 0; start < sourceEntries.length; start += 4) {
      const batch = sourceEntries.slice(start, start + 4);
      const contents = await Promise.all(batch.map(async (entry) => {
        const filePath = normalizeRepositoryRelativePath(entry.path ?? '');
        if (!filePath || filePath !== entry.path || filePath.split('/').some((part) => part === '.' || part === '..')) {
          throw new Error('GitHub source tree contains an unsafe file path');
        }
        const response = await this.fetchImpl(`${apiRoot}/git/blobs/${encodeURIComponent(entry.sha ?? '')}`, {
          headers: this.headers,
          signal: AbortSignal.timeout(15_000),
        });
        if (!response.ok) throw new Error(`GitHub source blob request failed: ${response.status}`);
        const blobText = await this.readBoundedText(response, Math.ceil((entry.size ?? 0) * 1.5) + 4096);
        const blobPayload = JSON.parse(blobText) as { encoding?: string; content?: string; size?: number };
        if (blobPayload.encoding !== 'base64' || typeof blobPayload.content !== 'string') {
          throw new Error('GitHub returned an unsupported source blob encoding');
        }
        const content = Buffer.from(blobPayload.content.replace(/\s/g, ''), 'base64');
        if (content.length !== entry.size || content.length > maxFileBytes) {
          throw new Error('GitHub source blob size did not match its bounded tree metadata');
        }
        return { path: filePath, content: content.toString('utf8') };
      }));
      files.push(...contents);
    }
    return files;
  }

  private get headers(): HeadersInit {
    return {
      Accept: 'application/vnd.github+json',
      ...(this.config.token ? { Authorization: `Bearer ${this.config.token}` } : {}),
    };
  }

  private async readBoundedText(response: Response, maxBytes: number): Promise<string> {
    if (!response.body) throw new Error('GitHub response body was empty');
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        totalBytes += value.byteLength;
        if (totalBytes > maxBytes) {
          await reader.cancel();
          throw new Error('GitHub response exceeded the configured byte limit');
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    return Buffer.concat(chunks).toString('utf8');
  }
}

export interface ProcessAnalysisJobInput {
  organizationId: string;
  jobId: string;
  resourceBudget?: { maxFiles: number; maxEntities: number; maxDurationMs: number };
}

export interface AnalysisJobProcessorDependencies {
  analysis: Pick<AnalysisRepository, 'getJob' | 'getRun' | 'getProfile' | 'updateJobStatus' | 'updateJobStage' | 'updateRunStatus'>;
  repositories: Pick<RepositoryRepository, 'getById'>;
  commits: Pick<CommitRepository, 'getById'>;
  entities: Pick<CodeEntityRepository, 'createOrUpdate'>;
  relationships: Pick<CodeRelationshipRepository, 'createOrGet'>;
  intelligence: Pick<RepositoryIntelligenceBuilder, 'build'>;
  impact: Pick<ImpactAnalysisEngine, 'analyzeImpact'>;
  orchestrator: Pick<AnalyzerOrchestrator, 'execute'>;
  health?: Pick<HealthRepository, 'createOrGetSnapshot'>;
  sources: AnalysisSourceProvider;
}

export class AnalysisJobProcessor {
  private readonly dependencies: AnalysisJobProcessorDependencies;

  constructor(dependencies: Partial<AnalysisJobProcessorDependencies> = {}) {
    this.dependencies = {
      analysis: dependencies.analysis ?? analysisRepository,
      repositories: dependencies.repositories ?? repositoriesRepository,
      commits: dependencies.commits ?? commitsRepository,
      entities: dependencies.entities ?? codeEntityRepository,
      relationships: dependencies.relationships ?? codeRelationshipRepository,
      intelligence: dependencies.intelligence ?? new RepositoryIntelligenceBuilder(),
      impact: dependencies.impact ?? new ImpactAnalysisEngine(),
      orchestrator: dependencies.orchestrator ?? analyzerOrchestrator,
      health: dependencies.health,
      sources: dependencies.sources ?? new GitCommitSourceProvider({ token: process.env.GITHUB_TOKEN }),
    };
  }

  async process(
    input: ProcessAnalysisJobInput,
    attempt: AnalysisAttemptContext = { attempt: 1, maxAttempts: 1 },
  ): Promise<Record<string, unknown>> {
    this.validateResourceBudget(input.resourceBudget);
    if (
      !Number.isSafeInteger(attempt.attempt)
      || !Number.isSafeInteger(attempt.maxAttempts)
      || attempt.attempt < 1
      || attempt.maxAttempts < attempt.attempt
    ) {
      throw new Error('Analysis attempt metadata is invalid');
    }
    const job = await this.dependencies.analysis.getJob(input.organizationId, input.jobId);
    if (!job) throw new Error(`Analysis job ${input.jobId} was not found`);
    if (!['PARSING', 'CODE_IR', 'INTELLIGENCE', 'QUALITY_ANALYSIS'].includes(job.stage)) {
      throw new Error(`Analysis job ${input.jobId} has unsupported stage ${job.stage}; expected a parsing/quality stage`);
    }
    const run = await this.dependencies.analysis.getRun(input.organizationId, job.run_id);
    if (!run) throw new Error(`Analysis run ${job.run_id} was not found`);
    if (run.organization_id !== input.organizationId) {
      throw new Error(`Analysis job ${input.jobId} references a run outside the requested organization`);
    }

    logAnalysisEvent('analysis.job.started', {
      organizationId: input.organizationId,
      jobId: job.id,
      analysisRunId: run.id,
      stage: job.stage,
    });
    await this.dependencies.analysis.updateJobStatus(input.organizationId, job.id, 'RUNNING', attempt.attempt);
    await this.dependencies.analysis.updateJobStage(input.organizationId, job.id, 'PARSING');
    await this.dependencies.analysis.updateRunStatus(input.organizationId, run.id, 'RUNNING', run.coverage);
    logAnalysisEvent('analysis.run.started', { organizationId: input.organizationId, jobId: job.id, analysisRunId: run.id });

    try {
      return await this.executePipeline(input, job, run);
    } catch (error) {
      const retrying = attempt.attempt < attempt.maxAttempts;
      const failureStatus = retrying ? 'RETRY' as const : 'DEAD_LETTER' as const;
      logAnalysisEvent('analysis.run.failed', {
        organizationId: input.organizationId,
        jobId: job.id,
        analysisRunId: run.id,
        attempt: attempt.attempt,
        maxAttempts: attempt.maxAttempts,
        retrying,
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
      const statusErrors: unknown[] = [];
      try {
        await this.dependencies.analysis.updateJobStatus(input.organizationId, job.id, failureStatus, attempt.attempt);
      } catch (statusError) {
        statusErrors.push(statusError);
      }
      try {
        await this.dependencies.analysis.updateRunStatus(input.organizationId, run.id, retrying ? 'RUNNING' : 'FAILED', {
          ...run.coverage,
          pipeline: {
            status: retrying ? 'RETRYING' : 'FAILED',
            attempt: attempt.attempt,
            maxAttempts: attempt.maxAttempts,
            error: error instanceof Error ? error.message : String(error),
          },
        });
      } catch (statusError) {
        statusErrors.push(statusError);
      }
      if (statusErrors.length > 0) {
        throw new AggregateError([error, ...statusErrors], 'Analysis failed and its failure status could not be fully persisted');
      }
      throw error;
    }
  }

  private async executePipeline(
    input: ProcessAnalysisJobInput,
    job: AnalysisJob,
    run: AnalysisRun,
  ): Promise<Record<string, unknown>> {
    const pipelineStarted = Date.now();
    const resourceBudget = input.resourceBudget ?? DEFAULT_ANALYSIS_RESOURCE_BUDGET;
    const repository = await this.dependencies.repositories.getById(input.organizationId, run.repository_id);
    if (!repository) throw new Error(`Repository ${run.repository_id} was not found`);
    const commit = await this.dependencies.commits.getById(input.organizationId, run.repository_id, run.commit_id);
    if (!commit) throw new Error(`Commit ${run.commit_id} was not found`);
    const profile = await this.dependencies.analysis.getProfile(input.organizationId, run.profile_id, run.profile_version);
    if (!profile) throw new Error(`Analysis profile ${run.profile_id}@${run.profile_version} was not found`);

    const parseStarted = Date.now();
    const sourceFiles = await this.dependencies.sources.readCommit(repository, commit);
    const sourceAccess = new InMemorySourceAccess();
    const relationships: Array<{
      sourceEntityId: string;
      targetEntityId: string;
      relation: CodeRelationshipRecord['relation'];
      resolution: 'EXACT' | 'INFERRED' | 'POSSIBLE' | 'UNKNOWN';
      confidence: CodeRelationshipRecord['confidence'];
      provenance: Record<string, unknown>;
    }> = [];
    const parseDiagnostics: string[] = [];
    let parsedFileCount = 0;
    let persistedEntityCount = 0;
    let entityBudgetExceeded = false;

    if (sourceFiles.length > resourceBudget.maxFiles) {
      parseDiagnostics.push(`Exceeded maxFiles budget (${resourceBudget.maxFiles}); only the first ${resourceBudget.maxFiles} source files will be analyzed`);
    }
    const filesWithinBudget = sourceFiles.slice(0, resourceBudget.maxFiles);
    for (const file of filesWithinBudget) {
      if (Date.now() - pipelineStarted >= resourceBudget.maxDurationMs) {
        parseDiagnostics.push(`Exceeded maxDurationMs budget (${resourceBudget.maxDurationMs}) while parsing source files`);
        break;
      }
      const language = normalizeLanguage(detectLanguageFromPath(file.path));
      if (language === 'UNKNOWN') continue;
      sourceAccess.setFile(file.path, file.content);
      const contentHash = createHash('sha256').update(file.content).digest('hex');
      const parsed = parseWithLanguageAdapter({
        repositoryId: run.repository_id,
        commitId: run.commit_id,
        filePath: file.path,
        language,
        contentHash,
        sourceContent: file.content,
      });
      parsedFileCount += 1;
      parseDiagnostics.push(...parsed.diagnostics.map((diagnostic) => `${file.path}: ${diagnostic}`));

      const persistedIds = new Map<string, string>();
      for (const entity of parsed.entities) {
        if (persistedEntityCount >= resourceBudget.maxEntities) {
          entityBudgetExceeded = true;
          break;
        }
        const entityType = entity.kind === 'VARIABLE' ? 'SYMBOL'
          : entity.kind === 'INTERFACE' ? 'TYPE'
            : entity.kind === 'NAMESPACE' ? 'MODULE'
            : entity.kind;
        const persisted = await this.dependencies.entities.createOrUpdate({
          organizationId: input.organizationId,
          repositoryId: run.repository_id,
          commitId: run.commit_id,
          entityKey: entity.id,
          entityType,
          name: entity.name,
          qualifiedName: entity.qualifiedName,
          filePath: entity.filePath,
          startLine: entity.startLine,
          endLine: entity.endLine,
          provenance: {
            ...entity.provenance,
            language: entity.language,
            parserVersion: parsed.parserVersion,
            irVersion: parsed.irVersion,
          },
        });
        persistedIds.set(entity.id, persisted.id);
        persistedEntityCount += 1;
      }
      for (const relationship of parsed.relationships) {
        const sourceEntityId = persistedIds.get(relationship.sourceEntityId);
        const targetEntityId = persistedIds.get(relationship.targetEntityId);
        if (!sourceEntityId || !targetEntityId) continue;
        relationships.push({
          sourceEntityId,
          targetEntityId,
          relation: relationship.kind,
          resolution: relationship.resolution,
          confidence: relationship.confidence === undefined ? null
            : relationship.confidence >= 0.9 ? 'HIGH'
              : relationship.confidence >= 0.65 ? 'MEDIUM' : 'LOW',
          provenance: { ...relationship.provenance, parserVersion: parsed.parserVersion },
        });
      }
      if (entityBudgetExceeded) {
        parseDiagnostics.push(`Exceeded maxEntities budget (${resourceBudget.maxEntities}); remaining parsed entities were skipped`);
        break;
      }
    }

    let persistedRelationshipCount = 0;
    for (const relationship of relationships) {
      await this.dependencies.relationships.createOrGet({
        organizationId: input.organizationId,
        repositoryId: run.repository_id,
        commitId: run.commit_id,
        sourceEntityId: relationship.sourceEntityId,
        targetEntityId: relationship.targetEntityId,
        relation: relationship.relation,
        resolution: relationship.resolution,
        confidence: relationship.confidence,
        provenance: relationship.provenance,
      });
      persistedRelationshipCount += 1;
    }
    const parseDurationMs = Date.now() - parseStarted;
    logAnalysisEvent('analysis.parser.completed', {
      organizationId: input.organizationId,
      jobId: job.id,
      analysisRunId: run.id,
      parsedFiles: parsedFileCount,
      persistedEntities: persistedEntityCount,
      durationMs: parseDurationMs,
    });

    await this.dependencies.analysis.updateJobStage(input.organizationId, job.id, 'INTELLIGENCE');
    const intelligenceStarted = Date.now();
    const intelligence = await this.dependencies.intelligence.build(input.organizationId, run.repository_id, run.commit_id);
    const intelligenceDurationMs = Date.now() - intelligenceStarted;
    logAnalysisEvent('analysis.intelligence.completed', {
      organizationId: input.organizationId,
      jobId: job.id,
      analysisRunId: run.id,
      status: intelligence.status,
      entities: intelligence.entities.length,
      relationships: intelligence.relationships.length,
      durationMs: intelligenceDurationMs,
    });
    const { scope, impactComplete, impactSummary } = this.buildScope(run, job, profile.max_depth, intelligence, resourceBudget);
    await this.dependencies.analysis.updateJobStage(input.organizationId, job.id, 'QUALITY_ANALYSIS');
    const analyzerResult = await this.dependencies.orchestrator.execute({
      organizationId: input.organizationId,
      repositoryId: run.repository_id,
      commitId: run.commit_id,
      analysisRunId: run.id,
      analysisProfileId: run.profile_id,
      analysisProfileVersion: run.profile_version,
      analysisScope: scope,
      repositoryIntelligence: intelligence,
      sourceAccess,
      resourceBudget: {
        ...resourceBudget,
        maxDurationMs: Math.max(0, resourceBudget.maxDurationMs - (Date.now() - pipelineStarted)),
      },
      codeIR: { entities: intelligence.entities, relationships: intelligence.relationships },
      language: 'TypeScript',
    });

    const analyzerStatuses = analyzerResult.results.map((result) => result.status);
    logAnalysisEvent('analysis.analyzers.completed', {
      organizationId: input.organizationId,
      jobId: job.id,
      analysisRunId: run.id,
      analyzerStatuses,
      findings: analyzerResult.findingIds.length,
    });
    const totalDurationMs = Date.now() - pipelineStarted;
    const budgetDiagnostics = totalDurationMs > resourceBudget.maxDurationMs
      ? [`Exceeded maxDurationMs budget (${resourceBudget.maxDurationMs})`]
      : [];
    const incomplete = parseDiagnostics.length > 0
      || budgetDiagnostics.length > 0
      || intelligence.status !== 'COMPLETE'
      || !impactComplete
      || analyzerStatuses.some((status) => status !== 'COMPLETED');
    let status = analyzerStatuses.length > 0 && analyzerStatuses.every((item) => item === 'FAILED')
      ? 'FAILED' as const
      : incomplete ? 'PARTIAL' as const : 'COMPLETED' as const;
    let health: Record<string, unknown>;
    try {
      const healthAssessment = repositoryHealthEngine.assess({
        organizationId: input.organizationId,
        repositoryId: run.repository_id,
        commitId: run.commit_id,
        analysisRunId: run.id,
        findings: analyzerResult.healthSignals ?? [],
        analyzerStatuses: analyzerResult.analyzerCoverage ?? {
          security: 'UNKNOWN',
          quality: 'UNKNOWN',
          maintainability: 'UNKNOWN',
        },
        upstreamComplete: status === 'COMPLETED' && scope.mode === 'FULL',
        sourceFileCount: sourceFiles.length,
        parsedFileCount: parsedFileCount,
      });
      const savedHealth = await (this.dependencies.health ?? healthRepository).createOrGetSnapshot({
        organizationId: input.organizationId,
        repositoryId: run.repository_id,
        commitId: run.commit_id,
        analysisRunId: run.id,
        profileId: healthAssessment.profile.id,
        profileVersion: healthAssessment.profile.version,
        modelVersion: healthAssessment.profile.modelVersion,
        overallScore: healthAssessment.overallScore,
        overallStatus: healthAssessment.overallStatus,
        coverage: healthAssessment.coverage,
        dimensions: healthAssessment.dimensions,
        profileSnapshot: { ...healthAssessment.profile },
        calculation: healthAssessment.calculation,
        explanation: healthAssessment.explanation,
        securityScore: healthAssessment.dimensions.security.score,
        qualityScore: healthAssessment.dimensions.quality.score,
        reliabilityScore: healthAssessment.dimensions.reliability.score,
        maintainabilityScore: healthAssessment.dimensions.maintainability.score,
        dependencyScore: healthAssessment.dimensions.dependencies.score,
      });
      health = {
        status: healthAssessment.overallStatus,
        coverage: healthAssessment.coverage,
        overallScore: healthAssessment.overallScore,
        snapshotId: savedHealth.record.id,
        created: savedHealth.created,
        dimensions: healthAssessment.dimensions,
        explanation: healthAssessment.explanation,
      };
    } catch (error) {
      status = status === 'FAILED' ? 'FAILED' : 'PARTIAL';
      health = {
        status: 'FAILED',
        coverage: 'UNKNOWN',
        diagnostics: [error instanceof Error ? error.message : 'Health calculation or persistence failed'],
      };
      logAnalysisEvent('analysis.health.failed', {
        organizationId: input.organizationId,
        jobId: job.id,
        analysisRunId: run.id,
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
    }
    const coverage = {
      ...run.coverage,
      pipeline: {
        status,
        sourceFiles: sourceFiles.length,
        parsedFiles: parsedFileCount,
        persistedEntities: persistedEntityCount,
        parsingDurationMs: parseDurationMs,
        parseDiagnostics,
        budgetDiagnostics,
        resourceBudget: {
          limits: resourceBudget,
          elapsedMs: totalDurationMs,
          exceeded: {
            maxFiles: sourceFiles.length > resourceBudget.maxFiles,
            maxEntities: entityBudgetExceeded,
            maxDurationMs: totalDurationMs > resourceBudget.maxDurationMs,
          },
        },
        irEntityCount: intelligence.entities.length,
        irRelationshipCount: intelligence.relationships.length,
        persistedRelationshipCount,
        intelligenceStatus: intelligence.status,
        intelligenceDurationMs,
        scope,
        impact: impactSummary,
        analyzers: analyzerResult.results.map((result) => ({ status: result.status, metrics: result.metrics, diagnostics: result.diagnostics })),
        findings: analyzerResult.findingIds.length,
        evidence: analyzerResult.evidenceMetrics,
        risk: analyzerResult.riskMetrics,
        health,
      },
    };
    await this.dependencies.analysis.updateRunStatus(input.organizationId, run.id, status, coverage);
    await this.dependencies.analysis.updateJobStatus(input.organizationId, job.id, status === 'FAILED' ? 'FAILED' : 'COMPLETED');
    logAnalysisEvent('analysis.run.completed', {
      organizationId: input.organizationId,
      jobId: job.id,
      analysisRunId: run.id,
      status,
      findings: analyzerResult.findingIds.length,
    });
    return coverage.pipeline;
  }

  private buildScope(
    run: AnalysisRun,
    job: AnalysisJob,
    profileMaxDepth: number | null,
    intelligence: Awaited<ReturnType<RepositoryIntelligenceBuilder['build']>>,
    resourceBudget?: ProcessAnalysisJobInput['resourceBudget'],
  ): { scope: AnalysisScopeDefinition; impactComplete: boolean; impactSummary: Record<string, unknown> } {
    if (run.scope === 'COMMIT' || run.scope === 'REPOSITORY') {
      return { scope: { mode: 'FULL' }, impactComplete: true, impactSummary: { mode: 'FULL' } };
    }

    const scopeMetadata = this.parseScopeKey(job.scope_key);
    if (run.scope === 'CHANGED_FILES') {
      const fileIds = scopeMetadata.fileIds ?? [];
      const changedEntities = intelligence.entities.filter((entity) => entity.file_path && fileIds.includes(entity.file_path)).map((entity) => entity.id);
      if (changedEntities.length === 0) {
        return {
          scope: { mode: 'FILE', fileIds, complete: false, reason: 'CHANGED_FILES' },
          impactComplete: false,
          impactSummary: { mode: 'FILE', selectedFiles: fileIds.length, diagnostic: 'No changed-file entities were available for impact analysis' },
        };
      }
      const impact = this.dependencies.impact.analyzeImpact(intelligence, {
        repositoryId: run.repository_id,
        commitId: run.commit_id,
        changedEntities,
        maxDepth: profileMaxDepth ?? 3,
        maxEntities: resourceBudget?.maxEntities ?? DEFAULT_ANALYSIS_RESOURCE_BUDGET.maxEntities,
        maxFiles: resourceBudget?.maxFiles ?? DEFAULT_ANALYSIS_RESOURCE_BUDGET.maxFiles,
      });
      const scopedEntityIds = Array.from(new Set([...changedEntities, ...impact.scope?.entityIds ?? []]));
      return {
        scope: {
          mode: 'IMPACTED',
          entityIds: scopedEntityIds,
          fileIds: impact.scope?.fileIds ?? fileIds,
          reason: impact.scope?.reason ?? 'CHANGE_IMPACT',
          complete: impact.complete,
        },
        impactComplete: impact.complete && !impact.requiresScopeExpansion,
        impactSummary: { changedEntities: changedEntities.length, affectedEntities: impact.affectedEntities.length, complete: impact.complete, truncated: impact.truncated, requiresScopeExpansion: impact.requiresScopeExpansion },
      };
    }

    if (run.scope === 'AFFECTED_SYMBOLS') {
      const changedEntities = scopeMetadata.changedEntityIds ?? [];
      if (changedEntities.length === 0) {
        return {
          scope: { mode: 'IMPACTED', entityIds: [], complete: false, reason: 'AFFECTED_SYMBOLS' },
          impactComplete: false,
          impactSummary: { mode: 'IMPACTED', diagnostic: 'No changed entity IDs were supplied; analysis scope was not widened' },
        };
      }
      const impact = this.dependencies.impact.analyzeImpact(intelligence, {
        repositoryId: run.repository_id,
        commitId: run.commit_id,
        changedEntities,
        maxDepth: profileMaxDepth ?? 3,
        maxEntities: resourceBudget?.maxEntities ?? DEFAULT_ANALYSIS_RESOURCE_BUDGET.maxEntities,
        maxFiles: resourceBudget?.maxFiles ?? DEFAULT_ANALYSIS_RESOURCE_BUDGET.maxFiles,
      });
      return {
        scope: {
          mode: 'IMPACTED',
          entityIds: Array.from(new Set([...changedEntities, ...impact.scope?.entityIds ?? []])),
          fileIds: impact.scope?.fileIds,
          reason: impact.scope?.reason ?? 'CHANGE_IMPACT',
          complete: impact.complete,
        },
        impactComplete: impact.complete && !impact.requiresScopeExpansion,
        impactSummary: { changedEntities: changedEntities.length, affectedEntities: impact.affectedEntities.length, complete: impact.complete, truncated: impact.truncated, requiresScopeExpansion: impact.requiresScopeExpansion },
      };
    }

    return {
      scope: { mode: 'IMPACTED', entityIds: [], complete: false, reason: 'UNSUPPORTED_SCOPE' },
      impactComplete: false,
      impactSummary: { mode: run.scope, diagnostic: 'The requested run scope cannot be safely translated to analyzer scope' },
    };
  }

  private parseScopeKey(scopeKey: string): { fileIds?: string[]; changedEntityIds?: string[] } {
    try {
      const parsed: unknown = JSON.parse(scopeKey);
      if (typeof parsed !== 'object' || parsed === null) return {};
      const record = parsed as Record<string, unknown>;
      return {
        fileIds: Array.isArray(record.fileIds) ? record.fileIds.filter((value): value is string => typeof value === 'string') : undefined,
        changedEntityIds: Array.isArray(record.changedEntityIds) ? record.changedEntityIds.filter((value): value is string => typeof value === 'string') : undefined,
      };
    } catch {
      return {};
    }
  }

  private validateResourceBudget(budget: ProcessAnalysisJobInput['resourceBudget']): void {
    if (!budget) return;
    for (const [name, value] of Object.entries(budget)) {
      if (!Number.isSafeInteger(value) || value < 0) {
        throw new Error(`Invalid analysis resource budget ${name}: expected a non-negative safe integer`);
      }
    }
  }
}

export const analysisJobProcessor = new AnalysisJobProcessor();
