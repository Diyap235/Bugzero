import { createHash } from 'node:crypto';

import {
  analysisRepository,
  aiInvestigationRepository,
  commitsRepository,
  evidenceRepository,
  findingsRepository,
  repositoryFilesRepository,
  repositoriesRepository,
  type AIInvestigationRepository,
  type AnalysisRepository,
  type AnalysisJob,
  type AnalysisRun,
  type CodeEntityRecord,
  type CodeRelationshipRecord,
  type CommitRepository,
  type EvidenceRepository,
  type FindingRepository,
  type RepositoryRepository,
  type RepositoryRecord,
  type RepositoryCommit,
  type RepositoryFileRepository,
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
import {
  CodeGraphRepository,
  codeGraphEntityId,
  codeGraphRelationshipId,
  codeGraphRepository,
} from '../graph/code-graph.repository.js';
import { buildSourceToSinkRelationships } from '../graph/source-to-sink.js';
import { buildDependencyGraph } from '../graph/dependency-graph-builder.js';
import { healthRepository } from '@bugzero/database';
import { repositoryHealthEngine } from '../health/health-engine.js';
import { createNvidiaInvestigator, selectNvidiaInvestigatorForRepository } from '../ai/nvidia/nvidia-client.js';
import { investigatePersistedFindings } from '../ai/investigator.js';
import type { AIInvestigator } from '../ai/investigation-types.js';
import type { AIRepositoryReviewOutcome, RepositoryReviewDimension } from '../ai/investigation-types.js';
import { buildRepositoryReviewContext } from '../ai/nvidia/repository-review-context.js';
import { mlSignalAdapter, type MLFunctionInput, type MLSignalReport, MAX_ML_FUNCTION_BYTES } from '../ml/ml-signal-adapter.js';

const DEFAULT_ANALYSIS_RESOURCE_BUDGET = {
  maxFiles: 2_000,
  maxEntities: 20_000,
  maxDurationMs: 60_000,
} as const;

const DEPENDENCY_MANIFEST_NAMES = new Set([
  'package.json',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'requirements.txt',
  'pyproject.toml',
  'poetry.lock',
  'pipfile',
  'pipfile.lock',
]);

function isDependencyManifestPath(filePath: string): boolean {
  return DEPENDENCY_MANIFEST_NAMES.has(filePath.split('/').at(-1)?.toLowerCase() ?? '');
}

function logAnalysisEvent(event: string, context: Record<string, unknown>): void {
  console.info(JSON.stringify({ event, ...context }));
}

function diagnosticError(error: unknown): { errorName: string; errorMessage: string; errorStack?: string } {
  const redact = (value: string): string => value
    .replace(/(postgres(?:ql)?:\/\/[^:\s/@]+:)[^@\s]+@/gi, '$1[REDACTED]@')
    .replace(/\bBearer\s+\S+/gi, 'Bearer [REDACTED]')
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g, '[REDACTED]');
  const errorName = error instanceof Error ? error.name : 'UnknownError';
  const errorMessage = error instanceof Error ? error.message : String(error);
  const errorStack = error instanceof Error ? error.stack : undefined;
  return {
    errorName,
    errorMessage: redact(errorMessage),
    ...(errorStack ? { errorStack: redact(errorStack) } : {}),
  };
}

function throwIfLeaseAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  throw signal.reason instanceof Error ? signal.reason : new Error('Analysis lease was lost');
}

export interface AnalysisSourceFile {
  path: string;
  content: string;
}

export interface AnalysisSourceProvider {
  readCommit(repository: RepositoryRecord, commit: RepositoryCommit): Promise<AnalysisSourceFile[]>;
}

function codeEntityType(entity: ReturnType<typeof parseWithLanguageAdapter>['entities'][number]): CodeEntityRecord['entity_type'] {
  if (entity.kind === 'VARIABLE') return 'SYMBOL';
  if (entity.kind === 'INTERFACE') return 'TYPE';
  if (entity.kind === 'NAMESPACE') return 'MODULE';
  return entity.kind;
}

function codeEntityRecord(
  scope: { organizationId: string; repositoryId: string; commitId: string; analysisRunId: string },
  entity: ReturnType<typeof parseWithLanguageAdapter>['entities'][number],
): CodeEntityRecord {
  return {
    id: codeGraphEntityId(scope, entity.id),
    organization_id: scope.organizationId,
    repository_id: scope.repositoryId,
    commit_id: scope.commitId,
    analysis_run_id: scope.analysisRunId,
    entity_key: entity.id,
    entity_type: codeEntityType(entity),
    name: entity.name,
    qualified_name: entity.qualifiedName,
    file_path: entity.filePath,
    start_line: entity.startLine,
    end_line: entity.endLine,
    provenance: entity.provenance,
    created_at: new Date().toISOString(),
  };
}

function codeRelationshipRecord(
  scope: { organizationId: string; repositoryId: string; commitId: string; analysisRunId: string },
  sourceEntityId: string,
  targetEntityId: string,
  relation: ReturnType<typeof parseWithLanguageAdapter>['relationships'][number],
  provenance: Record<string, unknown>,
): CodeRelationshipRecord {
  return {
    id: codeGraphRelationshipId(scope, sourceEntityId, relation.kind, targetEntityId),
    organization_id: scope.organizationId,
    repository_id: scope.repositoryId,
    commit_id: scope.commitId,
    analysis_run_id: scope.analysisRunId,
    source_entity_id: sourceEntityId,
    target_entity_id: targetEntityId,
    relation: relation.kind,
    resolution: relation.resolution,
    confidence: relation.confidence === undefined ? null
      : relation.confidence >= 0.9 ? 'HIGH'
        : relation.confidence >= 0.65 ? 'MEDIUM' : 'LOW',
    provenance,
    created_at: new Date().toISOString(),
  };
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
      && (normalizeLanguage(detectLanguageFromPath(entry.path)) !== 'UNKNOWN' || isDependencyManifestPath(entry.path)));

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

export class RepositorySourceProvider implements AnalysisSourceProvider {
  constructor(
    private readonly github = new GitCommitSourceProvider({ token: process.env.GITHUB_TOKEN }),
    private readonly localFiles: Pick<RepositoryFileRepository, 'listByCommit'> = repositoryFilesRepository,
  ) {}

  async readCommit(repository: RepositoryRecord, commit: RepositoryCommit): Promise<AnalysisSourceFile[]> {
    if (repository.provider === 'GITHUB') {
      return this.github.readCommit(repository, commit);
    }
    if (repository.provider !== 'LOCAL') {
      throw new Error(`Analysis does not support repository provider ${repository.provider}`);
    }

    const files = await this.localFiles.listByCommit(repository.organization_id, repository.id, commit.id);
    if (files.length === 0) throw new Error('The local repository snapshot contains no persisted source files');
    return files.map((file) => {
      if (file.source_content === null) {
        throw new Error(`The local repository snapshot is missing source content for ${file.path}`);
      }
      const bytes = Buffer.from(file.source_content, 'utf8');
      if (
        bytes.length !== Number(file.size_bytes)
        || createHash('sha256').update(bytes).digest('hex') !== file.content_sha256
      ) {
        throw new Error(`The persisted source content failed integrity verification for ${file.path}`);
      }
      return { path: file.path, content: file.source_content };
    });
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
  graph: Pick<CodeGraphRepository, 'writeSnapshot' | 'writeRelationships' | 'listByRun'>;
  intelligence: Pick<RepositoryIntelligenceBuilder, 'build'>;
  impact: Pick<ImpactAnalysisEngine, 'analyzeImpact'>;
  orchestrator: Pick<AnalyzerOrchestrator, 'execute'>;
  health?: Pick<HealthRepository, 'createOrGetSnapshot'>;
  aiInvestigator: AIInvestigator;
  findings: Pick<FindingRepository, 'getById' | 'getOccurrencesForFinding'>;
  evidence: Pick<EvidenceRepository, 'getEvidenceForFinding' | 'getSnapshot'>;
  aiInvestigations: Pick<AIInvestigationRepository, 'getByIdempotencyKey' | 'createOrGet'>;
  mlSignals: Pick<typeof mlSignalAdapter, 'predictFunctions'>;
  sources: AnalysisSourceProvider;
}

export class AnalysisJobProcessor {
  private readonly dependencies: AnalysisJobProcessorDependencies;

  constructor(dependencies: Partial<AnalysisJobProcessorDependencies> = {}) {
    const graph = dependencies.graph ?? codeGraphRepository;
    this.dependencies = {
      analysis: dependencies.analysis ?? analysisRepository,
      repositories: dependencies.repositories ?? repositoriesRepository,
      commits: dependencies.commits ?? commitsRepository,
      graph,
      intelligence: dependencies.intelligence ?? new RepositoryIntelligenceBuilder(graph),
      impact: dependencies.impact ?? new ImpactAnalysisEngine(),
      orchestrator: dependencies.orchestrator ?? analyzerOrchestrator,
      health: dependencies.health,
      aiInvestigator: dependencies.aiInvestigator ?? createNvidiaInvestigator(),
      findings: dependencies.findings ?? findingsRepository,
      evidence: dependencies.evidence ?? evidenceRepository,
      aiInvestigations: dependencies.aiInvestigations ?? aiInvestigationRepository,
      mlSignals: dependencies.mlSignals ?? mlSignalAdapter,
      sources: dependencies.sources ?? new RepositorySourceProvider(),
    };
  }

  async process(
    input: ProcessAnalysisJobInput,
    attempt: AnalysisAttemptContext = { attempt: 1, maxAttempts: 1 },
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    const jobProcessingStartedAt = Date.now();
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
      attempt: attempt.attempt,
      maxAttempts: attempt.maxAttempts,
      queueWaitMs: job.started_at
        ? Math.max(0, Date.parse(job.started_at) - Date.parse(job.created_at))
        : null,
      workerPreparationDurationMs: job.started_at
        ? Math.max(0, Date.now() - Date.parse(job.started_at))
        : Date.now() - jobProcessingStartedAt,
    });
    throwIfLeaseAborted(signal);
    if (job.status !== 'RUNNING' || job.attempt !== attempt.attempt) {
      await this.dependencies.analysis.updateJobStatus(input.organizationId, job.id, 'RUNNING', attempt.attempt);
    }
    await this.dependencies.analysis.updateJobStage(input.organizationId, job.id, 'PARSING');
    await this.dependencies.analysis.updateRunStatus(input.organizationId, run.id, 'RUNNING', run.coverage);
    logAnalysisEvent('analysis.run.started', {
      organizationId: input.organizationId,
      jobId: job.id,
      analysisRunId: run.id,
      startupDurationMs: Date.now() - jobProcessingStartedAt,
    });

    let currentStage: AnalysisJob['stage'] = 'PARSING';
    try {
      throwIfLeaseAborted(signal);
      return await this.executePipeline(input, job, run, signal, (stage) => { currentStage = stage; });
    } catch (error) {
      if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : error;
      const retrying = attempt.attempt < attempt.maxAttempts;
      logAnalysisEvent('analysis.run.failed', {
        organizationId: input.organizationId,
        jobId: job.id,
        analysisRunId: run.id,
        attempt: attempt.attempt,
        maxAttempts: attempt.maxAttempts,
        currentPipelineStage: currentStage,
        retrying,
        ...diagnosticError(error),
      });
      const statusErrors: unknown[] = [];
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
    signal?: AbortSignal,
    onStage?: (stage: AnalysisJob['stage']) => void,
  ): Promise<Record<string, unknown>> {
    throwIfLeaseAborted(signal);
    const pipelineStarted = Date.now();
    const inputsStartedAt = Date.now();
    const resourceBudget = input.resourceBudget ?? DEFAULT_ANALYSIS_RESOURCE_BUDGET;
    const repository = await this.dependencies.repositories.getById(input.organizationId, run.repository_id);
    if (!repository) throw new Error(`Repository ${run.repository_id} was not found`);
    const aiInvestigator = selectNvidiaInvestigatorForRepository(
      repository.provider,
      this.dependencies.aiInvestigator,
    );
    const commit = await this.dependencies.commits.getById(input.organizationId, run.repository_id, run.commit_id);
    if (!commit) throw new Error(`Commit ${run.commit_id} was not found`);
    const profile = await this.dependencies.analysis.getProfile(input.organizationId, run.profile_id, run.profile_version);
    if (!profile) throw new Error(`Analysis profile ${run.profile_id}@${run.profile_version} was not found`);

    const inputsDurationMs = Date.now() - inputsStartedAt;
    logAnalysisEvent('analysis.inputs.loaded', {
      organizationId: input.organizationId,
      jobId: job.id,
      analysisRunId: run.id,
      durationMs: inputsDurationMs,
    });
    const sourceReadStartedAt = Date.now();
    logAnalysisEvent('analysis.sources.read.started', {
      organizationId: input.organizationId,
      jobId: job.id,
      analysisRunId: run.id,
    });
    const sourceFiles = await this.dependencies.sources.readCommit(repository, commit);
    const sourceReadDurationMs = Date.now() - sourceReadStartedAt;
    logAnalysisEvent('analysis.sources.read.completed', {
      organizationId: input.organizationId,
      jobId: job.id,
      analysisRunId: run.id,
      sourceFiles: sourceFiles.length,
      sourceBytes: sourceFiles.reduce((total, file) => total + Buffer.byteLength(file.content, 'utf8'), 0),
      durationMs: sourceReadDurationMs,
    });

    const parseStarted = Date.now();
    const sourceAccess = new InMemorySourceAccess();
    const graphEntities: CodeEntityRecord[] = [];
    const graphRelationships: CodeRelationshipRecord[] = [];
    const parseDiagnostics: string[] = [];
    const parsedLanguages = new Set<string>();
    let parsedFileCount = 0;
    let persistedEntityCount = 0;
    let entityBudgetExceeded = false;

    if (sourceFiles.length > resourceBudget.maxFiles) {
      parseDiagnostics.push(`Exceeded maxFiles budget (${resourceBudget.maxFiles}); only the first ${resourceBudget.maxFiles} source files will be analyzed`);
    }
    const filesWithinBudget = sourceFiles.slice(0, resourceBudget.maxFiles);
    for (const file of filesWithinBudget) {
      throwIfLeaseAborted(signal);
      if (Date.now() - pipelineStarted >= resourceBudget.maxDurationMs) {
        parseDiagnostics.push(`Exceeded maxDurationMs budget (${resourceBudget.maxDurationMs}) while parsing source files`);
        break;
      }
      const language = normalizeLanguage(detectLanguageFromPath(file.path));
      if (language === 'UNKNOWN') continue;
      parsedLanguages.add(language);
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
      parseDiagnostics.push(...parsed.diagnostics.map((diagnostic) =>
        diagnostic.startsWith(`${file.path}:`) ? diagnostic : `${file.path}: ${diagnostic}`));

      if (persistedEntityCount >= resourceBudget.maxEntities) {
        entityBudgetExceeded = true;
        parseDiagnostics.push(`Exceeded maxEntities budget (${resourceBudget.maxEntities}); remaining parsed entities were skipped`);
        break;
      }
      const scope = {
        organizationId: input.organizationId,
        repositoryId: run.repository_id,
        commitId: run.commit_id,
        analysisRunId: run.id,
      };
      const fileEntity: CodeEntityRecord = {
        id: codeGraphEntityId(scope, `file:${file.path}`),
        organization_id: input.organizationId,
        repository_id: run.repository_id,
        commit_id: run.commit_id,
        analysis_run_id: run.id,
        entity_key: `file:${file.path}`,
        entity_type: 'FILE',
        name: file.path.split('/').at(-1) ?? file.path,
        qualified_name: file.path,
        file_path: file.path,
        start_line: 1,
        end_line: file.content.split(/\r\n|\r|\n/).length,
        provenance: { language, parserVersion: parsed.parserVersion, irVersion: parsed.irVersion, contentHash },
        created_at: new Date().toISOString(),
      };
      graphEntities.push(fileEntity);
      persistedEntityCount += 1;

      const persistedIds = new Map<string, string>();
      for (const entity of parsed.entities) {
        if (persistedEntityCount >= resourceBudget.maxEntities) {
          entityBudgetExceeded = true;
          break;
        }
        const record = codeEntityRecord(scope, entity);
        record.provenance = {
          ...entity.provenance,
          language: entity.language,
          parserVersion: parsed.parserVersion,
          irVersion: parsed.irVersion,
        };
        graphEntities.push(record);
        persistedIds.set(entity.id, record.id);
        persistedEntityCount += 1;
      }
      const fileModule = parsed.entities.find((entity) => entity.kind === 'MODULE');
      const fileModuleId = fileModule ? persistedIds.get(fileModule.id) : undefined;
      if (fileModuleId) {
        graphRelationships.push(codeRelationshipRecord(scope, fileEntity.id, fileModuleId, {
          id: `file-declares-module:${file.path}`,
          sourceEntityId: fileEntity.id,
          targetEntityId: fileModuleId,
          kind: 'DECLARES',
          resolution: 'EXACT',
          confidence: 1,
          provenance: { parserVersion: parsed.parserVersion },
        }, { parserVersion: parsed.parserVersion }));
      }
      let omittedRelationships = 0;
      for (const relationship of parsed.relationships) {
        const sourceEntityId = persistedIds.get(relationship.sourceEntityId);
        const targetEntityId = persistedIds.get(relationship.targetEntityId);
        if (!sourceEntityId || !targetEntityId) {
          omittedRelationships += 1;
          continue;
        }
        graphRelationships.push(codeRelationshipRecord(scope, sourceEntityId, targetEntityId, relationship, {
          ...relationship.provenance,
          parserVersion: parsed.parserVersion,
        }));
      }
      if (omittedRelationships > 0) {
        parseDiagnostics.push(`${file.path}: skipped ${omittedRelationships} graph relationships because their entities exceeded the resource budget`);
      }
      if (entityBudgetExceeded) {
        parseDiagnostics.push(`Exceeded maxEntities budget (${resourceBudget.maxEntities}); remaining parsed entities were skipped`);
        break;
      }
      await new Promise<void>((resolve) => setImmediate(resolve));
    }

    const sourceParseDiagnostics = [...parseDiagnostics];
    throwIfLeaseAborted(signal);
    const dependencyGraph = buildDependencyGraph(
      {
        organizationId: input.organizationId,
        repositoryId: run.repository_id,
        commitId: run.commit_id,
        analysisRunId: run.id,
      },
      filesWithinBudget,
      Math.max(0, resourceBudget.maxEntities - persistedEntityCount),
      new Set(graphEntities.map((entity) => entity.id)),
    );
    graphEntities.push(...dependencyGraph.entities);
    graphRelationships.push(...dependencyGraph.relationships);
    persistedEntityCount += dependencyGraph.entities.length;
    parseDiagnostics.push(...dependencyGraph.diagnostics);
    entityBudgetExceeded ||= dependencyGraph.budgetExceeded;

    throwIfLeaseAborted(signal);
    await this.dependencies.graph.writeSnapshot({
      organizationId: input.organizationId,
      repositoryId: run.repository_id,
      commitId: run.commit_id,
      analysisRunId: run.id,
    }, { entities: graphEntities, relationships: graphRelationships });
    const persistedRelationshipCount = graphRelationships.length;
    const parseDurationMs = Date.now() - parseStarted;
    logAnalysisEvent('analysis.parser.completed', {
      organizationId: input.organizationId,
      jobId: job.id,
      analysisRunId: run.id,
      parsedFiles: parsedFileCount,
      persistedEntities: persistedEntityCount,
      durationMs: parseDurationMs,
    });

    throwIfLeaseAborted(signal);
    await this.dependencies.analysis.updateJobStage(input.organizationId, job.id, 'INTELLIGENCE');
    onStage?.('INTELLIGENCE');
    const intelligenceStarted = Date.now();
    const intelligence = await this.dependencies.intelligence.build(input.organizationId, run.repository_id, run.commit_id, run.id);
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
    throwIfLeaseAborted(signal);
    await this.dependencies.analysis.updateJobStage(input.organizationId, job.id, 'QUALITY_ANALYSIS');
    onStage?.('QUALITY_ANALYSIS');
    const analyzerStartedAt = Date.now();
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
      languages: [...parsedLanguages],
    });

    const graphScope = {
      organizationId: input.organizationId,
      repositoryId: run.repository_id,
      commitId: run.commit_id,
      analysisRunId: run.id,
    };
    const dataflowStartedAt = Date.now();
    const sourceToSink = buildSourceToSinkRelationships(
      graphScope,
      analyzerResult.results.flatMap((result) => result.findings),
      new Set(intelligence.entities.map((entity) => entity.id)),
    );
    await this.dependencies.graph.writeRelationships(graphScope, sourceToSink.relationships);
    logAnalysisEvent('analysis.graph.dataflow.completed', {
      organizationId: input.organizationId,
      jobId: job.id,
      analysisRunId: run.id,
      relationships: sourceToSink.relationships.length,
      diagnostics: sourceToSink.diagnostics.length,
      durationMs: Date.now() - dataflowStartedAt,
    });

    const analyzerStatuses = analyzerResult.results.map((result) => result.status);
    const deterministicAnalysisDurationMs = Date.now() - analyzerStartedAt;
    logAnalysisEvent('analysis.analyzers.completed', {
      organizationId: input.organizationId,
      jobId: job.id,
      analysisRunId: run.id,
      analyzerStatuses,
      findings: analyzerResult.findingIds.length,
      durationMs: deterministicAnalysisDurationMs,
    });
    const totalDurationMs = Date.now() - pipelineStarted;
    const budgetDiagnostics = totalDurationMs > resourceBudget.maxDurationMs
      ? [`Exceeded maxDurationMs budget (${resourceBudget.maxDurationMs})`]
      : [];
    const healthSourceFileCount = sourceFiles.filter((file) =>
      normalizeLanguage(detectLanguageFromPath(file.path)) !== 'UNKNOWN').length;
    const fullRepositoryEvidence = run.scope === 'REPOSITORY' && scope.mode === 'FULL';
    const commonHealthUpstreamComplete = fullRepositoryEvidence
      && sourceParseDiagnostics.length === 0
      && parsedFileCount === healthSourceFileCount
      && intelligence.status === 'COMPLETE'
      && impactComplete
      && budgetDiagnostics.length === 0;
    const analysisDiagnostics: string[] = [];
    if (parsedFileCount === 0) {
      analysisDiagnostics.push(sourceFiles.length === 0
        ? 'No repository files were supplied; source-level findings could not be ruled out'
        : 'No supported source files were parsed; source-level findings could not be ruled out');
    }
    if (analyzerStatuses.length === 0) {
      analysisDiagnostics.push('No analyzers ran; findings could not be ruled out');
    }
    const incomplete = parseDiagnostics.length > 0
      || sourceToSink.diagnostics.length > 0
      || budgetDiagnostics.length > 0
      || analysisDiagnostics.length > 0
      || intelligence.status !== 'COMPLETE'
      || !impactComplete
      || analyzerStatuses.some((status) => status !== 'COMPLETED');
    let status = analyzerStatuses.length > 0 && analyzerStatuses.every((item) => item === 'FAILED')
      ? 'FAILED' as const
      : incomplete ? 'PARTIAL' as const : 'COMPLETED' as const;
    let health: Record<string, unknown>;
    let aiReview: AIRepositoryReviewOutcome = {
      status: 'UNAVAILABLE',
      result: null,
      errorCode: 'MISSING_CONFIGURATION',
    };
    let healthAssessmentDurationMs = 0;
    let repositoryReviewContextDurationMs = 0;
    let aiReviewDurationMs = 0;
    let healthSnapshotDurationMs = 0;
    try {
      const healthAssessmentStartedAt = Date.now();
      const healthAssessment = repositoryHealthEngine.assess({
        organizationId: input.organizationId,
        repositoryId: run.repository_id,
        commitId: run.commit_id,
        analysisRunId: run.id,
        analysisScope: run.scope,
        findings: analyzerResult.healthSignals ?? [],
        analyzerStatuses: analyzerResult.analyzerCoverage ?? {
          security: 'UNKNOWN',
          quality: 'UNKNOWN',
          maintainability: 'UNKNOWN',
        },
        upstreamCompleteness: {
          security: commonHealthUpstreamComplete && sourceToSink.diagnostics.length === 0,
          quality: commonHealthUpstreamComplete,
          maintainability: commonHealthUpstreamComplete,
        },
        sourceFileCount: healthSourceFileCount,
        parsedFileCount: parsedFileCount,
      });
      healthAssessmentDurationMs = Date.now() - healthAssessmentStartedAt;
      const reviewContextStartedAt = Date.now();
      const reviewContext = buildRepositoryReviewContext({
        analysisStatus: status,
        sourceFiles,
        parsedFileCount,
      });
      repositoryReviewContextDurationMs = Date.now() - reviewContextStartedAt;
      const reviewContextCharacters = Buffer.byteLength(JSON.stringify(reviewContext), 'utf8');
      const reviewStartedAt = Date.now();
      logAnalysisEvent('analysis.ai_review.started', {
        organizationId: input.organizationId,
        jobId: job.id,
        analysisRunId: run.id,
        provider: aiInvestigator.provider,
        sourceFilesProvided: reviewContext.files.filter((file) => file.kind === 'SOURCE').length,
        dependencyManifestsProvided: reviewContext.files.filter((file) => file.kind === 'DEPENDENCY_MANIFEST').length,
        contextCharacters: reviewContextCharacters,
      });
      try {
        aiReview = aiInvestigator.reviewRepository
          ? await aiInvestigator.reviewRepository(reviewContext, signal)
          : { status: 'UNAVAILABLE', result: null, errorCode: 'MISSING_CONFIGURATION' };
      } catch (error) {
        aiReview = { status: 'FAILED', result: null, errorCode: 'PROVIDER_ERROR' };
        logAnalysisEvent('analysis.ai_review.failed', {
          organizationId: input.organizationId,
          jobId: job.id,
          analysisRunId: run.id,
          errorName: error instanceof Error ? error.name : 'UnknownError',
        });
      }
      aiReviewDurationMs = Date.now() - reviewStartedAt;
      throwIfLeaseAborted(signal);
      const reviewDimensionKeys = {
        SECURITY: 'security',
        QUALITY: 'quality',
        MAINTAINABILITY: 'maintainability',
        RELIABILITY: 'reliability',
        DEPENDENCIES: 'dependencies',
      } as const satisfies Record<RepositoryReviewDimension, keyof typeof healthAssessment.dimensions>;
      const estimateCoverage = {
        sourceFilesProvided: reviewContext.files.filter((file) => file.kind === 'SOURCE').length,
        sourceFilesAvailable: reviewContext.sourceFileCount,
        sourceCoveragePercent: reviewContext.sourceFileCount === 0
          ? null
          : Math.round((reviewContext.files.filter((file) => file.kind === 'SOURCE').length
            / reviewContext.sourceFileCount) * 100),
        dependencyManifestsProvided: reviewContext.files.filter((file) => file.kind === 'DEPENDENCY_MANIFEST').length,
      };
      if (aiReview.status === 'COMPLETED') {
        for (const [reviewKey, healthKey] of Object.entries(reviewDimensionKeys) as Array<
          [RepositoryReviewDimension, keyof typeof healthAssessment.dimensions]
        >) {
          const reviewDimension = aiReview.result.dimensions[reviewKey];
          const verifiedDimension = healthAssessment.dimensions[healthKey];
          if (reviewDimension.score !== null && reviewDimension.confidence !== null
            && reviewDimension.evidence.length > 0) {
            verifiedDimension.estimatedScore = reviewDimension.score;
            verifiedDimension.estimateConfidence = reviewDimension.confidence;
            verifiedDimension.estimateExplanation = reviewDimension.explanation;
            verifiedDimension.estimateEvidence = reviewDimension.evidence;
            verifiedDimension.estimateCoverage = estimateCoverage;
          }
          verifiedDimension.aiFindings = aiReview.result.findings
            .filter((finding) => finding.dimension === reviewKey)
            .map(({ dimension: _dimension, ...finding }) => finding);
        }
      }
      const estimatedWeights = {
        security: 35,
        quality: 20,
        maintainability: 15,
        reliability: 15,
        dependencies: 15,
      } as const;
      const estimatedDimensions = Object.entries(estimatedWeights).flatMap(([name, weight]) => {
        const dimension = healthAssessment.dimensions[name as keyof typeof healthAssessment.dimensions];
        const score = dimension.score ?? dimension.estimatedScore ?? null;
        return score === null ? [] : [{
          name,
          score,
          weight,
          source: dimension.score !== null ? 'DETERMINISTIC' : 'AI_ESTIMATE',
        }];
      });
      const estimatedWeight = estimatedDimensions.reduce((total, item) => total + item.weight, 0);
      const hasAIEstimate = Object.values(healthAssessment.dimensions)
        .some((dimension) => dimension.estimatedScore !== null && dimension.estimatedScore !== undefined);
      const estimatedOverallScore = estimatedWeight === 0 || !hasAIEstimate ? null
        : Math.round(estimatedDimensions.reduce((total, item) => total + item.score * item.weight, 0) / estimatedWeight);
      healthAssessment.calculation = {
        ...healthAssessment.calculation,
        aiReview: {
          status: aiReview.status,
          errorCode: aiReview.errorCode,
          providerStatus: 'providerStatus' in aiReview ? aiReview.providerStatus ?? null : null,
        },
        aiEstimatedOverallScore: estimatedOverallScore,
        aiEstimatedDimensions: estimatedDimensions,
        aiEstimatedDimensionWeights: estimatedWeights,
      };
      const healthSnapshotStartedAt = Date.now();
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
      healthSnapshotDurationMs = Date.now() - healthSnapshotStartedAt;
      health = {
        status: healthAssessment.overallStatus,
        coverage: healthAssessment.coverage,
        overallScore: healthAssessment.overallScore,
        snapshotId: savedHealth.record.id,
        created: savedHealth.created,
        dimensions: healthAssessment.dimensions,
        explanation: healthAssessment.explanation,
      };
      logAnalysisEvent('analysis.ai_review.outcome', {
        organizationId: input.organizationId,
        jobId: job.id,
        analysisRunId: run.id,
        status: aiReview.status,
        errorCode: aiReview.errorCode,
        providerStatus: 'providerStatus' in aiReview ? aiReview.providerStatus ?? null : null,
        attempts: 'attempts' in aiReview ? aiReview.attempts ?? null : null,
        durationMs: aiReviewDurationMs,
        contextCharacters: reviewContextCharacters,
        contextBuildDurationMs: repositoryReviewContextDurationMs,
        healthAssessmentDurationMs,
        healthSnapshotDurationMs,
        findings: aiReview.status === 'COMPLETED' ? aiReview.result.findings.length : 0,
        estimatedDimensions: estimatedDimensions.length,
        sourceFilesProvided: estimateCoverage.sourceFilesProvided,
        sourceFilesAvailable: estimateCoverage.sourceFilesAvailable,
        dependencyManifestsProvided: estimateCoverage.dependencyManifestsProvided,
      });
    } catch (error) {
      if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : error;
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
errorMessage: error instanceof Error ? error.message : String(error),
errorStack: error instanceof Error ? error.stack : undefined,      });
    }
    let mlSignals: MLSignalReport;
    const mlSignalsStartedAt = Date.now();
    try {
      const candidates: MLFunctionInput[] = [];
      for (const entity of intelligence.entities) {
        if (
          !['FUNCTION', 'METHOD'].includes(entity.entity_type)
          || entity.provenance.language !== 'Python'
          || !entity.file_path
          || entity.start_line === null
          || entity.end_line === null
        ) continue;
        const inScope = scope.mode === 'FULL'
          || (scope.mode === 'FILE' && (scope.fileIds ?? []).includes(entity.file_path))
          || (scope.mode === 'ENTITY' && (scope.entityIds ?? []).includes(entity.id))
          || (scope.mode === 'IMPACTED' && (
            (scope.entityIds ?? []).includes(entity.id)
            || (scope.fileIds ?? []).includes(entity.file_path)
          ));
        if (!inScope) continue;
        candidates.push({
          functionId: entity.id,
          functionName: entity.qualified_name ?? entity.name,
          filePath: entity.file_path,
          startLine: entity.start_line,
          endLine: entity.end_line,
          source: sourceAccess.getLineRange(
            entity.file_path,
            entity.start_line,
            entity.end_line,
          ).join('\n'),
        });
      }
      mlSignals = await this.dependencies.mlSignals.predictFunctions(candidates);
      if (candidates.some((candidate) => Buffer.byteLength(candidate.source, 'utf8') > MAX_ML_FUNCTION_BYTES)) {
        logAnalysisEvent('analysis.ml.functions_skipped', {
          organizationId: input.organizationId,
          jobId: job.id,
          analysisRunId: run.id,
          oversizedFunctions: mlSignals.oversizedFunctionsSkipped,
        });
      }
    } catch {
      mlSignals = {
        status: 'UNAVAILABLE',
        signals: [],
        functionsConsidered: 0,
        functionsScored: 0,
        duplicateFunctionsAvoided: 0,
        oversizedFunctionsSkipped: 0,
        errorCode: 'INFERENCE_FAILED',
      };
    }
    logAnalysisEvent('analysis.ml.completed', {
      organizationId: input.organizationId,
      jobId: job.id,
      analysisRunId: run.id,
      status: mlSignals.status,
      functionsScored: mlSignals.functionsScored,
      durationMs: Date.now() - mlSignalsStartedAt,
    });
    const aiInvestigationStartedAt = Date.now();
    const aiInvestigation = await investigatePersistedFindings({
      organizationId: input.organizationId,
      repositoryId: run.repository_id,
      commitId: run.commit_id,
      analysisRunId: run.id,
      analysisStatus: status,
      findingIds: analyzerResult.findingIds,
      sourceAccess,
      investigator: aiInvestigator,
      findings: this.dependencies.findings,
      evidence: this.dependencies.evidence,
      investigations: this.dependencies.aiInvestigations,
      signal,
    });
    const aiInvestigationDurationMs = Date.now() - aiInvestigationStartedAt;
    const endToEndDurationMs = Date.now() - pipelineStarted;
    const coverage = {
      ...run.coverage,
      pipeline: {
        status,
        sourceFiles: sourceFiles.length,
        parsedFiles: parsedFileCount,
        persistedEntities: persistedEntityCount,
        parsingDurationMs: parseDurationMs,
        parseDiagnostics,
        analysisDiagnostics,
        graphDiagnostics: sourceToSink.diagnostics,
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
        mlSignals,
        health,
        aiReview,
        aiInvestigation,
        timings: {
          databaseInputsMs: inputsDurationMs,
          sourceReadMs: sourceReadDurationMs,
          parsingAndGraphWriteMs: parseDurationMs,
          intelligenceMs: intelligenceDurationMs,
          deterministicAnalysisMs: deterministicAnalysisDurationMs,
          healthAssessmentMs: healthAssessmentDurationMs,
          reviewContextBuildMs: repositoryReviewContextDurationMs,
          aiRepositoryReviewMs: aiReviewDurationMs,
          healthSnapshotPersistenceMs: healthSnapshotDurationMs,
          mlSignalsMs: Date.now() - mlSignalsStartedAt,
          aiInvestigationMs: aiInvestigationDurationMs,
          endToEndMs: endToEndDurationMs,
        },
      },
    };
    throwIfLeaseAborted(signal);
    await this.dependencies.analysis.updateRunStatus(input.organizationId, run.id, status, coverage);
    logAnalysisEvent('analysis.run.completed', {
      organizationId: input.organizationId,
      jobId: job.id,
      analysisRunId: run.id,
      status,
      findings: analyzerResult.findingIds.length,
      durationMs: endToEndDurationMs,
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
