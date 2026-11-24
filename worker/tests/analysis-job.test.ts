import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import type {
  AnalysisJob,
  AnalysisProfile,
  AnalysisRun,
  CodeEntityRecord,
  CodeRelationshipRecord,
  CreateFindingInput,
  CreateFindingOccurrenceInput,
  CreateOrGetResult,
  Finding,
  FindingOccurrence,
  RepositoryCommit,
  RepositoryRecord,
} from '@bugzero/database';

import { AnalyzerOrchestrator } from '../src/analyzers/analyzer-orchestrator.js';
import { AnalyzerRegistry } from '../src/analyzers/analyzer-registry.js';
import { structuralQualityAnalyzer } from '../src/analyzers/structural-quality/analyzer.js';
import { sqlInjectionAnalyzer } from '../src/analyzers/security/sql-injection-analyzer.js';
import { InMemorySourceAccess } from '../src/analyzers/source-access.js';
import { AnalysisJobProcessor } from '../src/jobs/process-analysis-job.js';
import { NvidiaInvestigator } from '../src/ai/nvidia/nvidia-client.js';

const disabledAiInvestigator = new NvidiaInvestigator({ environment: {} });
import { ImpactAnalysisEngine } from '../src/intelligence/impact-analysis.js';
import type { RepositoryIntelligenceSnapshot } from '../src/intelligence/types.js';
import type { AnalysisSourceFile } from '../src/jobs/process-analysis-job.js';
import { MemoryEvidenceRepository } from './support/memory-evidence.js';
import { MemoryRiskAssessmentRepository } from './support/memory-risk-assessments.js';
import { MemoryHealthRepository } from './support/memory-health-repository.js';
import { MLSignalAdapter } from '../src/ml/ml-signal-adapter.js';

class MemoryFindingRepository {
  readonly findings = new Map<string, Finding>();
  readonly occurrences = new Map<string, FindingOccurrence>();
  private sequence = 0;

  async createOrGet(input: CreateFindingInput): Promise<CreateOrGetResult<Finding>> {
    const key = `${input.organizationId}|${input.repositoryId}|${input.ruleId}|${input.identityFingerprint}`;
    const existing = this.findings.get(key);
    if (existing) return { record: existing, created: false };
    const record: Finding = {
      id: `finding-${this.findings.size + 1}`,
      organization_id: input.organizationId,
      repository_id: input.repositoryId,
      rule_id: input.ruleId,
      identity_fingerprint: input.identityFingerprint,
      identity_version: input.identityVersion,
      lifecycle: 'OPEN',
      current_occurrence_id: null,
      resolution_evidence_id: null,
      current_severity: input.currentSeverity,
      current_confidence: input.currentConfidence,
      current_risk: input.currentRisk,
      last_seen_commit_id: input.lastSeenCommitId ?? null,
      business_priority: input.businessPriority ?? null,
      accepted_risk: false,
      exception_id: null,
      disposition_reason: null,
      created_at: new Date(0).toISOString(),
      updated_at: new Date(0).toISOString(),
    };
    this.findings.set(key, record);
    return { record, created: true };
  }

  async createOccurrenceIfAbsent(input: CreateFindingOccurrenceInput): Promise<CreateOrGetResult<FindingOccurrence>> {
    const key = `${input.organizationId}|${input.findingId}|${input.analysisRunId}`;
    const existing = this.occurrences.get(key);
    if (existing) return { record: existing, created: false };
    const record: FindingOccurrence = {
      id: `occurrence-${++this.sequence}`,
      organization_id: input.organizationId,
      finding_id: input.findingId,
      repository_id: input.repositoryId,
      commit_id: input.commitId,
      analysis_run_id: input.analysisRunId,
      rule_id: input.ruleId,
      semantic_target_id: input.semanticTargetId,
      normalized_fingerprint: input.normalizedFingerprint,
      relationship_fingerprint: input.relationshipFingerprint ?? null,
      file_path: input.filePath ?? null,
      start_line: input.startLine ?? null,
      end_line: input.endLine ?? null,
      observation: input.observation,
      severity: input.severity,
      confidence: input.confidence,
      evidence_strength: input.evidenceStrength,
      exploitability: input.exploitability,
      reachability: input.reachability,
      technical_risk: input.technicalRisk,
      resolution: input.resolution,
      match_result: input.matchResult,
      created_at: new Date(0).toISOString(),
    };
    this.occurrences.set(key, record);
    return { record, created: true };
  }

  async updateCurrentRisk(_organizationId: string, findingId: string, currentRisk: number): Promise<void> {
    const finding = [...this.findings.values()].find((item) => item.id === findingId);
    if (!finding) throw new Error('Finding not found');
    finding.current_risk = currentRisk;
  }
}

function buildFixture(): AnalysisSourceFile[] {
  const lines = [
    'function longFunction() {',
    ...Array.from({ length: 99 }, (_, index) => `  const line${index} = ${index};`),
    '}',
    'function eightParameters(a, b, c, d, e, f, g, h) { return h; }',
    'function highFanOut() {',
    ...Array.from({ length: 16 }, (_, index) => `  callee${index}();`),
    '}',
    ...Array.from({ length: 16 }, (_, index) => `function callee${index}() { return ${index}; }`),
    'function highFanInTarget() { return 1; }',
    ...Array.from({ length: 21 }, (_, index) => `function caller${index}() { highFanInTarget(); }`),
    'function emptyFunction() {}',
    'function vulnerableQuery(req) {',
    '  const id = req.query.id;',
    '  const sql = "SELECT * FROM users WHERE id=" + id;',
    '  db.query(sql);',
    '}',
  ];
  return [
    { path: 'src/fixture.ts', content: lines.join('\n') },
    { path: 'requirements.txt', content: 'flask==2.0.0\nrequests>=2.25\n' },
  ];
}

test('QUALITY_ANALYSIS job runs parser → persisted Code IR → Repository Intelligence → impact/scope → orchestrator → findings', async () => {
  const organizationId = '11111111-1111-4111-8111-111111111111';
  const repositoryId = '22222222-2222-4222-8222-222222222222';
  const commitId = '33333333-3333-4333-8333-333333333333';
  const runId = '44444444-4444-4444-8444-444444444444';
  const jobId = '55555555-5555-4555-8555-555555555555';
  const repository: RepositoryRecord = {
    id: repositoryId,
    organization_id: organizationId,
    provider: 'GITHUB',
    external_id: 'fixture',
    full_name: 'org/fixture',
    default_branch: 'main',
    clone_url: 'https://example.invalid/org/fixture.git',
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
  };
  const commit: RepositoryCommit = {
    id: commitId,
    organization_id: organizationId,
    repository_id: repositoryId,
    commit_sha: 'a'.repeat(40),
    parent_commit_sha: null,
    committed_at: null,
    indexed_at: null,
    created_at: new Date(0).toISOString(),
  };
  const profile: AnalysisProfile = {
    id: 'default',
    organization_id: organizationId,
    version: '1',
    analyzers: [{ name: 'structural-quality-analyzer' }],
    max_depth: 3,
    created_at: new Date(0).toISOString(),
  };
  const run: AnalysisRun = {
    id: runId,
    organization_id: organizationId,
    repository_id: repositoryId,
    commit_id: commitId,
    profile_id: profile.id,
    profile_version: profile.version,
    scope: 'COMMIT',
    status: 'NOT_STARTED',
    coverage: {},
    created_at: new Date(0).toISOString(),
    started_at: null,
    completed_at: null,
  };
  const job: AnalysisJob = {
    id: jobId,
    organization_id: organizationId,
    run_id: runId,
    stage: 'QUALITY_ANALYSIS',
    analyzer: 'structural-quality-analyzer',
    analyzer_type: 'STRUCTURAL',
    scope_key: '{"mode":"FULL"}',
    status: 'QUEUED',
    attempt: 0,
    idempotency_key: 'test-run',
    created_at: new Date(0).toISOString(),
    started_at: null,
    finished_at: null,
  };
  const persistedEntities = new Map<string, CodeEntityRecord>();
  const persistedRelationships = new Map<string, CodeRelationshipRecord>();
  let sourceFiles = buildFixture();
  let capturedReviewRequest: string | undefined;
  const reviewResponse = {
    dimensions: {
      SECURITY: { score: 55, confidence: 'HIGH', explanation: 'Advisory source estimate.', evidence: [{ filePath: 'src/fixture.ts', line: 1 }] },
      QUALITY: { score: 80, confidence: 'MEDIUM', explanation: 'Advisory source estimate.', evidence: [{ filePath: 'src/fixture.ts', line: 1 }] },
      MAINTAINABILITY: { score: 75, confidence: 'MEDIUM', explanation: 'Advisory source estimate.', evidence: [{ filePath: 'src/fixture.ts', line: 1 }] },
      RELIABILITY: { score: 60, confidence: 'LOW', explanation: 'Advisory source estimate.', evidence: [{ filePath: 'src/fixture.ts', line: 1 }] },
      DEPENDENCIES: { score: 70, confidence: 'MEDIUM', explanation: 'Manifest hygiene estimate.', evidence: [{ filePath: 'requirements.txt', line: 1 }] },
    },
    findings: [{
      dimension: 'SECURITY',
      title: 'Advisory SQL query concern',
      severity: 'HIGH',
      filePath: 'src/fixture.ts',
      startLine: 1,
      endLine: 1,
      explanation: 'Advisory only; deterministic results remain authoritative.',
      remediation: 'Use a parameterized query.',
    }],
  };
  const repositoryReviewer = new NvidiaInvestigator({
    environment: { BUGZERO_ENABLE_EXTERNAL_AI: 'true', NVIDIA_API_KEY: 'server-only', NVIDIA_MODEL: 'test-model' },
    client: {
      async create(input) {
        capturedReviewRequest = JSON.stringify(input);
        return { choices: [{ message: { content: JSON.stringify(reviewResponse) } }] };
      },
    },
  });
  const reviewInvestigator = new NvidiaInvestigator({ environment: {} });
  reviewInvestigator.reviewRepository = (context, signal) => repositoryReviewer.reviewRepository(context, signal);
  const findingRepository = new MemoryFindingRepository();
  const evidenceRepository = new MemoryEvidenceRepository();
  const riskRepository = new MemoryRiskAssessmentRepository();
  const healthMemoryRepository = new MemoryHealthRepository();
  let failML = false;
  let riskStateAtML: string | undefined;
  const mlSignals = new MLSignalAdapter(async (functions) => {
    riskStateAtML = JSON.stringify([...riskRepository.assessments.values()]);
    if (failML) throw new Error('simulated model unavailable');
    return functions.map(() => ({ model_version: 'v1', label: 'vulnerable', score: 0.87 }));
  });
  const registry = new AnalyzerRegistry();
  registry.register(structuralQualityAnalyzer);
  registry.register(sqlInjectionAnalyzer);
  const orchestrator = new AnalyzerOrchestrator(registry, findingRepository, evidenceRepository, riskRepository);

  const processor = new AnalysisJobProcessor({
    aiInvestigator: reviewInvestigator,
    analysis: {
      async getJob() { return job; },
      async getRun() { return run; },
      async getProfile() { return profile; },
      async updateJobStatus(_organizationId, _jobId, status) {
        job.status = status;
        return job;
      },
      async updateJobStage(_organizationId, _jobId, stage) {
        job.stage = stage;
        return job;
      },
      async updateRunStatus(_organizationId, _runId, status, coverage) {
        run.status = status;
        run.coverage = coverage;
        return run;
      },
    },
    repositories: { async getById() { return repository; } },
    commits: {
      async getById(_orgId, _repoId, requestedCommitId) {
        return requestedCommitId === commit.id
          ? commit
          : { ...commit, id: requestedCommitId, commit_sha: 'b'.repeat(40) };
      },
    },
    graph: {
      async writeSnapshot(_scope, snapshot) {
        for (const entity of snapshot.entities) persistedEntities.set(entity.entity_key, entity);
        for (const relationship of snapshot.relationships) {
          const identity = `${relationship.source_entity_id}|${relationship.target_entity_id}|${relationship.relation}`;
          persistedRelationships.set(identity, relationship);
        }
      },
      async writeRelationships(_scope, relationships) {
        for (const relationship of relationships) {
          const identity = `${relationship.source_entity_id}|${relationship.target_entity_id}|${relationship.relation}`;
          persistedRelationships.set(identity, relationship);
        }
      },
      async listByRun() {
        return {
          entities: Array.from(persistedEntities.values()),
          relationships: Array.from(persistedRelationships.values()),
        };
      },
    },
    intelligence: {
      async build(orgId, repoId, requestedCommitId): Promise<RepositoryIntelligenceSnapshot> {
        const parsedEntities = Array.from(persistedEntities.values());
        const sourceEntity = parsedEntities[0];
        const missingSourceEntity: CodeEntityRecord | null = sourceEntity
          ? {
            ...sourceEntity,
            id: 'missing-source-entity',
            entity_key: 'missing-source-entity',
            entity_type: 'MODULE',
            name: 'missing-source',
            qualified_name: 'missing-source',
            file_path: 'src/missing.ts',
            start_line: 1,
            end_line: 1,
          }
          : null;
        const entities: CodeEntityRecord[] = missingSourceEntity
          ? [...parsedEntities, missingSourceEntity]
          : parsedEntities;
        const relationships = Array.from(persistedRelationships.values());
        const outgoingRelationships = new Map<string, CodeRelationshipRecord[]>();
        const incomingRelationships = new Map<string, CodeRelationshipRecord[]>();
        for (const relationship of relationships) {
          outgoingRelationships.set(relationship.source_entity_id, [
            ...(outgoingRelationships.get(relationship.source_entity_id) ?? []),
            relationship,
          ]);
          incomingRelationships.set(relationship.target_entity_id, [
            ...(incomingRelationships.get(relationship.target_entity_id) ?? []),
            relationship,
          ]);
        }
        return {
          organizationId: orgId,
          repositoryId: repoId,
          commitId: requestedCommitId,
          status: 'COMPLETE',
          entities,
          relationships,
          dependencies: [],
          dependencyRelationships: [],
          dependencyEdges: [],
          entityIndex: new Map(entities.map((entity) => [entity.id, entity])),
          outgoingRelationships,
          incomingRelationships,
          createdAt: new Date(0).toISOString(),
          irVersion: 'bugzero-ir-v2',
        };
      },
    },
    impact: new ImpactAnalysisEngine(),
    orchestrator: {
      async execute(options) {
        const result = await orchestrator.execute(options);
        options.repositoryIntelligence?.entities.push({
          id: 'ml-function-fixture',
          organization_id: organizationId,
          repository_id: repositoryId,
          commit_id: commitId,
          entity_key: 'ml-function-fixture',
          entity_type: 'FUNCTION',
          name: 'unsafe_query_fixture',
          qualified_name: 'unsafe_query_fixture',
          file_path: 'src/fixture.ts',
          start_line: 1,
          end_line: 1,
          provenance: { language: 'Python' },
          created_at: new Date(0).toISOString(),
        });
        return result;
      },
    },
    health: healthMemoryRepository,
    mlSignals,
    sources: { async readCommit() { return sourceFiles; } },
  });

  const coverage = await processor.process({ organizationId, jobId });
  const ruleIds = new Set(Array.from(findingRepository.findings.values()).map((finding) => finding.rule_id));
  assert.equal(run.status, 'PARTIAL', 'the advisory review must not upgrade incomplete deterministic analyzer coverage');
  assert.equal(job.status, 'RUNNING');
  assert.equal(persistedEntities.size > 40, true);
  assert.equal(persistedRelationships.size > 60, true);
  assert.deepEqual(
    ['LONG_FUNCTION', 'HIGH_PARAMETER_COUNT', 'HIGH_FAN_OUT', 'HIGH_FAN_IN', 'EMPTY_FUNCTION', 'SECURITY.SQL_INJECTION'].filter((ruleId) => ruleIds.has(ruleId)),
    ['LONG_FUNCTION', 'HIGH_PARAMETER_COUNT', 'HIGH_FAN_OUT', 'HIGH_FAN_IN', 'EMPTY_FUNCTION', 'SECURITY.SQL_INJECTION'],
  );
  assert.equal((coverage as { findings: number }).findings, 6);
  assert.equal((run.coverage.pipeline as Record<string, unknown>).irEntityCount, persistedEntities.size + 2);
  assert.equal(evidenceRepository.graphs.size, 6);
  assert.equal(riskRepository.assessments.size, 6);
  assert.equal(healthMemoryRepository.snapshots.size, 1);
  const firstPipeline = coverage as { mlSignals: {
    status: string;
    signals: Array<{ modelVersion: string; label: string; score: number; function: { filePath: string } }>;
    functionsScored: number;
  } };
  assert.equal(firstPipeline.mlSignals.status, 'AVAILABLE');
  assert.equal(firstPipeline.mlSignals.functionsScored, 1);
  assert.equal(firstPipeline.mlSignals.signals[0]?.modelVersion, 'v1');
  assert.equal(firstPipeline.mlSignals.signals[0]?.label, 'vulnerable');
  assert.equal(firstPipeline.mlSignals.signals[0]?.score, 0.87);
  assert.equal(firstPipeline.mlSignals.signals[0]?.function.filePath, 'src/fixture.ts');
  const deterministicRiskState = JSON.stringify([...riskRepository.assessments.values()]);
  assert.deepEqual(Object.keys(firstPipeline.mlSignals.signals[0] ?? {}).sort(), [
    'function', 'label', 'modelVersion', 'score', 'timestamp',
  ]);
  const healthSnapshot = [...healthMemoryRepository.snapshots.values()][0];
  assert.ok(healthSnapshot);
  assert.equal(healthSnapshot.organization_id, organizationId);
  assert.equal(healthSnapshot.repository_id, repositoryId);
  assert.equal(healthSnapshot.commit_id, commitId);
  assert.equal(healthSnapshot.analysis_run_id, runId);
  assert.equal(healthSnapshot.profile_id, 'default-v1');
  assert.equal(healthSnapshot.overall_status, 'PARTIAL');
  assert.equal(healthSnapshot.coverage, 'PARTIAL');
  assert.equal((healthSnapshot.calculation as Record<string, unknown>).analysisScope, 'COMMIT');
  const pipelineHealth = (coverage as { health: { status: string; overallScore: number | null } }).health;
  assert.equal(pipelineHealth.status, healthSnapshot.overall_status);
  assert.equal(pipelineHealth.overallScore, healthSnapshot.overall_score);
  assert.match(capturedReviewRequest ?? '', /src\/fixture\.ts/);
  assert.match(capturedReviewRequest ?? '', /requirements\.txt/);
  assert.match(capturedReviewRequest ?? '', /SELECT \* FROM users/);
  assert.match(capturedReviewRequest ?? '', /"stream":false/);
  const healthDimensions = healthSnapshot.dimensions as {
    security: {
      score: number | null;
      estimatedScore?: number | null;
      estimateConfidence?: string | null;
      estimateCoverage?: { sourceFilesProvided: number; sourceFilesAvailable: number; dependencyManifestsProvided: number };
      aiFindings?: Array<{ title: string }>;
      inputMetrics: { findingCount: number; totalTechnicalRisk: number };
    };
    quality: { score: number | null };
    maintainability: { score: number | null };
    dependencies: { score: number | null; estimatedScore?: number | null; estimateCoverage?: { dependencyManifestsProvided: number }; status: string };
    reliability: { score: number | null; estimatedScore?: number | null };
  };
  assert.ok((healthDimensions.security.score ?? 100) < 100);
  assert.equal(healthDimensions.security.estimatedScore, 55);
  assert.equal(healthDimensions.security.score, Math.round(100 - 20 * healthDimensions.security.inputMetrics.totalTechnicalRisk / 100));
  assert.equal(healthDimensions.security.estimateConfidence, 'HIGH');
  assert.deepEqual(healthDimensions.security.estimateCoverage, {
    sourceFilesProvided: 1,
    sourceFilesAvailable: 1,
    sourceCoveragePercent: 100,
    dependencyManifestsProvided: 1,
  });
  assert.equal(healthDimensions.security.aiFindings?.[0]?.title, 'Advisory SQL query concern');
  assert.equal(healthDimensions.dependencies.estimatedScore, 70);
  assert.equal(healthDimensions.dependencies.estimateCoverage?.dependencyManifestsProvided, 1);
  assert.equal(healthDimensions.reliability.score, null);
  assert.equal(healthDimensions.reliability.estimatedScore, 60);
  assert.equal(typeof (healthSnapshot.calculation as Record<string, unknown>).aiEstimatedOverallScore, 'number');
  assert.equal(healthDimensions.security.inputMetrics.findingCount, 1);
  assert.equal(healthDimensions.dependencies.score, null);
  assert.equal(healthDimensions.dependencies.status, 'UNKNOWN');
  assert.equal(findingRepository.findings.size, 6, 'advisory findings must not be added to deterministic findings');
  const persistedOccurrences = [...findingRepository.occurrences.values()];
  for (const graph of evidenceRepository.graphs.values()) {
    const occurrence = persistedOccurrences.find((item) => item.id === graph.snapshot.finding_occurrence_id);
    assert.ok(occurrence, 'evidence snapshot must link to a persisted finding occurrence');
    assert.equal(graph.snapshot.analysis_run_id, occurrence.analysis_run_id);
    assert.equal(graph.snapshot.commit_id, occurrence.commit_id);
    assert.equal(graph.snapshot.repository_id, occurrence.repository_id);
    assert.equal(graph.snapshot.authority, 'AUTHORITATIVE');
    assert.equal(graph.snapshot.origin, 'DETERMINISTIC_ANALYZER');
    assert.equal(graph.snapshot.completeness, 'COMPLETE');
    assert.equal(graph.snapshot.sufficiency, 'SUFFICIENT');
  }
  const graphForRule = (ruleId: string) => {
    const finding = [...findingRepository.findings.values()].find((item) => item.rule_id === ruleId);
    assert.ok(finding, `expected finding for ${ruleId}`);
    const graph = [...evidenceRepository.graphs.values()].find((entry) => entry.snapshot.finding_id === finding.id);
    assert.ok(graph, `expected evidence graph for ${ruleId}`);
    return graph;
  };
  const longGraph = graphForRule('LONG_FUNCTION');
  assert.equal(longGraph.snapshot.sufficiency, 'SUFFICIENT');
  assert.equal(longGraph.snapshot.completeness, 'COMPLETE');
  assert.equal(longGraph.nodes.some((node) => node.attributes.fact === 'SOURCE_SPAN_EXCEEDS_THRESHOLD' && node.line === 1 && node.end_line === 101), true);
  const parameterGraph = graphForRule('HIGH_PARAMETER_COUNT');
  assert.equal(parameterGraph.edges.filter((edge) => edge.relation === 'DECLARES' && edge.resolution === 'EXACT').length, 8);
  assert.equal(parameterGraph.nodes.filter((node) => node.node_type === 'PARAMETER').length, 8);
  assert.equal(parameterGraph.snapshot.paths.length, 8);
  const fanOutGraph = graphForRule('HIGH_FAN_OUT');
  assert.equal(fanOutGraph.edges.filter((edge) => edge.relation === 'CALLS' && edge.resolution === 'EXACT').length, 16);
  const fanOutAnchor = fanOutGraph.nodes.find((node) => node.attributes.fact === 'EXACT_OUTGOING_CALL_COUNT');
  assert.ok(fanOutAnchor);
  assert.equal(fanOutGraph.edges.every((edge) => edge.from_node_key === fanOutAnchor.node_key), true);
  const fanInGraph = graphForRule('HIGH_FAN_IN');
  assert.equal(fanInGraph.edges.filter((edge) => edge.relation === 'CALLS' && edge.resolution === 'EXACT').length, 21);
  const fanInAnchor = fanInGraph.nodes.find((node) => node.attributes.fact === 'EXACT_INCOMING_CALL_COUNT');
  assert.ok(fanInAnchor);
  assert.equal(fanInGraph.edges.every((edge) => edge.to_node_key === fanInAnchor.node_key), true);
  const emptyGraph = graphForRule('EMPTY_FUNCTION');
  assert.equal(emptyGraph.nodes.some((node) => node.node_type === 'SOURCE' && node.attributes.classification === 'EMPTY_BODY'), true);
  assert.equal(emptyGraph.edges.some((edge) => edge.relation === 'CONTAINS'), true);
  assert.equal(emptyGraph.snapshot.paths.length, 1);
  const sqlInjectionGraph = graphForRule('SECURITY.SQL_INJECTION');
  assert.equal(sqlInjectionGraph.snapshot.authority, 'AUTHORITATIVE');
  assert.equal(sqlInjectionGraph.snapshot.sufficiency, 'SUFFICIENT');
  assert.equal(sqlInjectionGraph.snapshot.completeness, 'COMPLETE');
  assert.ok(sqlInjectionGraph.nodes.some((node) => node.node_type === 'SOURCE'));
  assert.ok(sqlInjectionGraph.nodes.some((node) => node.node_type === 'SINK'));
  assert.ok(sqlInjectionGraph.nodes.every((node) => node.attributes.provenance === 'SECURITY_ANALYZER'));
  assert.equal(sqlInjectionGraph.snapshot.authority, 'AUTHORITATIVE');
  assert.equal(sqlInjectionGraph.snapshot.completeness, 'COMPLETE');
  assert.equal(sqlInjectionGraph.snapshot.sufficiency, 'SUFFICIENT');
  assert.equal(riskStateAtML, deterministicRiskState);

  failML = true;
  const unavailableCoverage = await processor.process({ organizationId, jobId });
  const unavailablePipeline = unavailableCoverage as { status: string; mlSignals: { status: string; signals: unknown[] } };
  assert.equal(unavailablePipeline.status, 'PARTIAL');
  assert.equal(run.status, 'PARTIAL');
  assert.equal(job.status, 'RUNNING');
  assert.equal(unavailablePipeline.mlSignals.status, 'UNAVAILABLE');
  assert.equal(unavailablePipeline.mlSignals.signals.length, 0);
  assert.equal(evidenceRepository.graphs.size, 6);
  assert.equal(riskRepository.assessments.size, 6);
  assert.equal(riskStateAtML, deterministicRiskState);
  assert.equal(JSON.stringify([...riskRepository.assessments.values()]), deterministicRiskState);
  assert.ok(sqlInjectionGraph.edges.some((edge) => edge.relation === 'REACHES_SQL_SINK' && edge.resolution === 'EXACT'));
  assert.ok(sqlInjectionGraph.snapshot.paths[0]?.nodeIds.length);
  const sqlFinding = [...findingRepository.findings.values()].find((item) => item.rule_id === 'SECURITY.SQL_INJECTION');
  assert.ok(sqlFinding);
  const sqlOccurrence = persistedOccurrences.find((item) => item.finding_id === sqlFinding.id);
  assert.ok(sqlOccurrence);
  assert.equal(sqlFinding.repository_id, healthSnapshot.repository_id);
  assert.equal(sqlOccurrence.analysis_run_id, healthSnapshot.analysis_run_id);
  const sqlRisk = [...riskRepository.assessments.values()].find((item) => item.finding_occurrence_id === sqlOccurrence.id);
  assert.ok(sqlRisk);
  assert.equal(sqlRisk.evidence_id, sqlInjectionGraph.snapshot.id);
  assert.equal(sqlRisk.evidence_authority, 'AUTHORITATIVE');
  assert.equal(sqlRisk.evidence_sufficiency, 'SUFFICIENT');
  assert.equal(sqlRisk.evidence_completeness, 'COMPLETE');
  assert.equal(sqlRisk.profile_id, 'default-v1');
  assert.equal(
    healthDimensions.security.score,
    Math.round(100 - (20 * Number(sqlRisk.technical_risk)) / 100),
    'security health should aggregate the persisted SQL Injection risk score',
  );
  assert.ok(typeof healthSnapshot.overall_score === 'number', 'scored dimensions should produce a provisional weighted score');
  assert.equal(healthSnapshot.overall_status, 'PARTIAL', 'commit-scoped health must be labeled partial despite its provisional score');
  assert.equal(healthSnapshot.coverage, 'PARTIAL');
  assert.equal((healthSnapshot.calculation as Record<string, unknown>).weightedCoverageComplete, false);

  await processor.process({ organizationId, jobId });
  assert.equal(findingRepository.findings.size, 6);
  assert.equal(findingRepository.occurrences.size, 6);
  assert.equal(evidenceRepository.graphs.size, 6);
  assert.equal(riskRepository.assessments.size, 6);
  assert.equal(healthMemoryRepository.snapshots.size, 1);

  await processor.process({
    organizationId,
    jobId,
    resourceBudget: { maxFiles: 2_000, maxEntities: 1, maxDurationMs: 60_000 },
  });
  const budgetPipeline = run.coverage.pipeline as {
    status: string;
    budgetDiagnostics: string[];
    resourceBudget: { exceeded: { maxEntities: boolean } };
  };
  assert.equal(run.status, 'PARTIAL');
  assert.equal(budgetPipeline.status, 'PARTIAL');
  assert.equal(budgetPipeline.resourceBudget.exceeded.maxEntities, true);
  assert.equal(budgetPipeline.budgetDiagnostics.length, 0);
  assert.equal(findingRepository.findings.size, 6);
  assert.equal(findingRepository.occurrences.size, 6);
  assert.equal(riskRepository.assessments.size, 6);
  assert.equal(healthMemoryRepository.snapshots.size, 1);

  const repeatedRunId = '99999999-9999-4999-8999-999999999999';
  run.id = repeatedRunId;
  run.status = 'NOT_STARTED';
  run.coverage = {};
  job.run_id = run.id;
  await processor.process({ organizationId, jobId });
  const repeatedRunOccurrences = [...findingRepository.occurrences.values()]
    .filter((occurrence) => occurrence.analysis_run_id === repeatedRunId);
  assert.equal(repeatedRunOccurrences.length, 6);
  for (const occurrence of repeatedRunOccurrences) {
    const graph = [...evidenceRepository.graphs.values()]
      .find((item) => item.snapshot.finding_occurrence_id === occurrence.id);
    const assessment = [...riskRepository.assessments.values()]
      .find((item) => item.finding_occurrence_id === occurrence.id);
    assert.ok(graph);
    assert.ok(assessment);
    assert.equal(graph.snapshot.analysis_run_id, repeatedRunId);
    assert.equal(assessment.analysis_run_id, repeatedRunId);
    assert.equal(assessment.evidence_id, graph.snapshot.id);
  }
  assert.equal(healthMemoryRepository.snapshots.size, 2);

  run.id = '88888888-8888-4888-8888-888888888888';
  run.status = 'NOT_STARTED';
  run.coverage = {};
  job.run_id = run.id;
  run.commit_id = '77777777-7777-4777-8777-777777777777';
  await processor.process({ organizationId, jobId });
  assert.equal(healthMemoryRepository.snapshots.size, 3);
  assert.equal(
    [...healthMemoryRepository.snapshots.values()].filter((snapshot) => snapshot.commit_id === commitId).length,
    2,
    'run-specific historical snapshots for the original commit must remain',
  );
  const findingCountBeforeHealthFailure = findingRepository.findings.size;
  const occurrenceCountBeforeHealthFailure = findingRepository.occurrences.size;
  const evidenceCountBeforeHealthFailure = evidenceRepository.graphs.size;
  const riskCountBeforeHealthFailure = riskRepository.assessments.size;
  const createHealthSnapshot = healthMemoryRepository.createOrGetSnapshot.bind(healthMemoryRepository);
  healthMemoryRepository.createOrGetSnapshot = async () => {
    throw new Error('health storage unavailable');
  };
  const failedHealthPipeline = await processor.process({ organizationId, jobId });
  assert.equal(run.status, 'PARTIAL');
  assert.equal((failedHealthPipeline.health as { status: string }).status, 'FAILED');
  assert.equal(findingRepository.findings.size, findingCountBeforeHealthFailure);
  assert.equal(findingRepository.occurrences.size, occurrenceCountBeforeHealthFailure);
  assert.equal(evidenceRepository.graphs.size, evidenceCountBeforeHealthFailure);
  assert.equal(riskRepository.assessments.size, riskCountBeforeHealthFailure);
  assert.equal(healthMemoryRepository.snapshots.size, 3);

  healthMemoryRepository.createOrGetSnapshot = createHealthSnapshot;
  sourceFiles = [{ path: 'README.md', content: 'No supported source code.' }];
  persistedEntities.clear();
  persistedRelationships.clear();
  run.id = '66666666-6666-4666-8666-666666666666';
  run.commit_id = commitId;
  run.status = 'NOT_STARTED';
  run.coverage = {};
  job.run_id = run.id;
  job.status = 'QUEUED';
  const unsupportedOnlyPipeline = await processor.process({ organizationId, jobId });
  assert.equal(unsupportedOnlyPipeline.status, 'PARTIAL');
  assert.deepEqual(unsupportedOnlyPipeline.analysisDiagnostics, [
    'No supported source files were parsed; source-level findings could not be ruled out',
  ]);
});

test('analysis job scope does not widen when changed-file metadata is missing', async () => {
  const organizationId = '11111111-1111-4111-8111-111111111111';
  const job: AnalysisJob = {
    id: 'job',
    organization_id: organizationId,
    run_id: 'run',
    stage: 'QUALITY_ANALYSIS',
    analyzer: 'structural-quality-analyzer',
    analyzer_type: 'STRUCTURAL',
    scope_key: '',
    status: 'QUEUED',
    attempt: 0,
    idempotency_key: 'scope-test',
    created_at: new Date(0).toISOString(),
    started_at: null,
    finished_at: null,
  };
  const run: AnalysisRun = {
    id: 'run',
    organization_id: organizationId,
    repository_id: 'repo',
    commit_id: 'commit',
    profile_id: 'profile',
    profile_version: '1',
    scope: 'CHANGED_FILES',
    status: 'NOT_STARTED',
    coverage: {},
    created_at: new Date(0).toISOString(),
    started_at: null,
    completed_at: null,
  };
  let capturedScope: unknown;
  const processor = new AnalysisJobProcessor({
    aiInvestigator: disabledAiInvestigator,
    analysis: {
      async getJob() { return job; },
      async getRun() { return run; },
      async getProfile() { return { id: 'profile', organization_id: organizationId, version: '1', analyzers: [], max_depth: null, created_at: '' }; },
      async updateJobStatus(_orgId, _jobId, status) { job.status = status; return job; },
      async updateJobStage(_orgId, _jobId, stage) { job.stage = stage; return job; },
      async updateRunStatus(_orgId, _runId, status, coverage) { run.status = status; run.coverage = coverage; return run; },
    },
    repositories: { async getById() { return { id: 'repo', organization_id: organizationId, provider: 'GITHUB', external_id: '', full_name: '', default_branch: '', clone_url: '', created_at: '', updated_at: '' }; } },
    commits: { async getById() { return { id: 'commit', organization_id: organizationId, repository_id: 'repo', commit_sha: 'a'.repeat(40), parent_commit_sha: null, committed_at: null, indexed_at: null, created_at: '' }; } },
    graph: {
      async writeSnapshot() {},
      async writeRelationships() {},
      async listByRun() { return { entities: [], relationships: [] }; },
    },
    intelligence: {
      async build() {
        return {
          organizationId,
          repositoryId: 'repo',
          commitId: 'commit',
          status: 'COMPLETE',
          entities: [],
          relationships: [],
          dependencies: [],
          dependencyRelationships: [],
          dependencyEdges: [],
          entityIndex: new Map(),
          outgoingRelationships: new Map(),
          incomingRelationships: new Map(),
          createdAt: '',
          irVersion: 'test',
        };
      },
    },
    impact: new ImpactAnalysisEngine(),
    health: new MemoryHealthRepository(),
    orchestrator: {
      async execute(input) {
        capturedScope = input.analysisScope;
        return {
          results: [],
          findingIds: [],
          evidenceMetrics: { snapshots: 0, nodes: 0, edges: 0, paths: 0, durationMs: 0, budgetExhausted: false },
          riskMetrics: { assessments: 0, failures: 0 },
        };
      },
    },
    sources: { async readCommit() { return []; } },
  });

  const emptyScopePipeline = await processor.process({ organizationId, jobId: job.id });
  assert.deepEqual(capturedScope, { mode: 'FILE', fileIds: [], complete: false, reason: 'CHANGED_FILES' });
  assert.equal(run.status, 'PARTIAL');
  assert.deepEqual(emptyScopePipeline.analysisDiagnostics, [
    'No repository files were supplied; source-level findings could not be ruled out',
    'No analyzers ran; findings could not be ruled out',
  ]);
});
