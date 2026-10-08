import test from 'node:test';
import assert from 'node:assert/strict';

import type {
  CodeEntityRecord,
  CodeRelationshipRecord,
  CreateFindingInput,
  CreateFindingOccurrenceInput,
  CreateOrGetResult,
  Finding,
  FindingOccurrence,
} from '@bugzero/database';

import { AnalyzerContext } from '../src/analyzers/analyzer-context.js';
import { AnalyzerOrchestrator } from '../src/analyzers/analyzer-orchestrator.js';
import { AnalyzerRegistry } from '../src/analyzers/analyzer-registry.js';
import { StructuralQualityAnalyzer, structuralQualityAnalyzer } from '../src/analyzers/structural-quality/analyzer.js';
import { emptyFunctionRule } from '../src/analyzers/structural-quality/rules/empty-function.js';
import { highFanInRule } from '../src/analyzers/structural-quality/rules/fan-in.js';
import { highFanOutRule } from '../src/analyzers/structural-quality/rules/fan-out.js';
import { longFunctionRule } from '../src/analyzers/structural-quality/rules/long-function.js';
import { highParameterCountRule } from '../src/analyzers/structural-quality/rules/parameter-count.js';
import { createFindingCandidate } from '../src/analyzers/structural-quality/rules/helpers.js';
import { InMemorySourceAccess } from '../src/analyzers/source-access.js';
import type { Analyzer, AnalyzerResult, Rule } from '../src/analyzers/types.js';
import type { RepositoryIntelligenceSnapshot } from '../src/intelligence/types.js';
import { MemoryEvidenceRepository } from './support/memory-evidence.js';
import { MemoryRiskAssessmentRepository } from './support/memory-risk-assessments.js';

const makeEntity = (overrides: Partial<CodeEntityRecord> = {}): CodeEntityRecord => ({
  id: overrides.id ?? 'entity-1',
  organization_id: overrides.organization_id ?? 'org-1',
  repository_id: overrides.repository_id ?? 'repo-1',
  commit_id: overrides.commit_id ?? 'commit-1',
  entity_key: overrides.entity_key ?? overrides.id ?? 'entity',
  entity_type: overrides.entity_type ?? 'FUNCTION',
  name: overrides.name ?? 'demo',
  qualified_name: overrides.qualified_name ?? 'src/demo.ts::demo',
  file_path: overrides.file_path ?? 'src/demo.ts',
  start_line: overrides.start_line ?? 1,
  end_line: overrides.end_line ?? 10,
  provenance: overrides.provenance ?? {},
  created_at: overrides.created_at ?? '2026-01-01T00:00:00.000Z',
});

const makeRelationship = (
  source: CodeEntityRecord,
  target: CodeEntityRecord,
  relation: CodeRelationshipRecord['relation'],
  id: string,
): CodeRelationshipRecord => ({
  id,
  organization_id: source.organization_id,
  repository_id: source.repository_id,
  commit_id: source.commit_id,
  source_entity_id: source.id,
  target_entity_id: target.id,
  relation,
  resolution: 'EXACT',
  confidence: 'HIGH',
  provenance: {},
  created_at: '2026-01-01T00:00:00.000Z',
});

function makeContext(options: {
  entities?: CodeEntityRecord[];
  relationships?: CodeRelationshipRecord[];
  sourceAccess?: InMemorySourceAccess;
  scope?: AnalyzerContext['analysisScope'];
  maxFiles?: number;
  maxEntities?: number;
  maxDurationMs?: number;
  repositoryIntelligence?: RepositoryIntelligenceSnapshot;
} = {}): AnalyzerContext {
  const entities = options.entities ?? [];
  const relationships = options.relationships ?? [];
  return new AnalyzerContext({
    organizationId: 'org-1',
    repositoryId: 'repo-1',
    commitId: 'commit-1',
    analysisRunId: 'run-1',
    analysisProfileId: 'profile-1',
    analysisScope: options.scope ?? { mode: 'FULL' },
    codeIR: { entities, relationships },
    repositoryIntelligence: options.repositoryIntelligence,
    sourceAccess: options.sourceAccess ?? new InMemorySourceAccess(),
    resourceBudget: {
      maxFiles: options.maxFiles ?? Number.MAX_SAFE_INTEGER,
      maxEntities: options.maxEntities ?? Number.MAX_SAFE_INTEGER,
      maxDurationMs: options.maxDurationMs ?? Number.MAX_SAFE_INTEGER,
    },
  });
}

function makeSnapshot(entities: CodeEntityRecord[], relationships: CodeRelationshipRecord[]): RepositoryIntelligenceSnapshot {
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
    organizationId: 'org-1',
    repositoryId: 'repo-1',
    commitId: 'commit-1',
    status: 'COMPLETE',
    entities,
    relationships,
    dependencies: [],
    dependencyEdges: [],
    entityIndex: new Map(entities.map((entity) => [entity.id, entity])),
    outgoingRelationships,
    incomingRelationships,
    createdAt: '2026-01-01T00:00:00.000Z',
    irVersion: 'bugzero-ir-v1',
  };
}

function makeFinding(input: CreateFindingInput): Finding {
  return {
    id: `finding-${input.identityFingerprint}`,
    organization_id: input.organizationId,
    repository_id: input.repositoryId,
    rule_id: input.ruleId,
    identity_fingerprint: input.identityFingerprint,
    identity_version: input.identityVersion,
    lifecycle: input.lifecycle ?? 'OPEN',
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
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };
}

class MemoryFindingRepository {
  readonly findings = new Map<string, Finding>();
  readonly occurrences = new Map<string, FindingOccurrence>();
  readonly occurrenceRuns = new Map<string, FindingOccurrence>();

  async createOrGet(input: CreateFindingInput): Promise<CreateOrGetResult<Finding>> {
    const key = `${input.organizationId}|${input.repositoryId}|${input.ruleId}|${input.identityFingerprint}`;
    const existing = this.findings.get(key);
    if (existing) return { record: existing, created: false };
    const record = makeFinding(input);
    this.findings.set(key, record);
    return { record, created: true };
  }

  async createOccurrenceIfAbsent(input: CreateFindingOccurrenceInput): Promise<CreateOrGetResult<FindingOccurrence>> {
    const identity = `${input.organizationId}|${input.findingId}|${input.commitId}|${input.normalizedFingerprint}`;
    const sameRun = `${input.organizationId}|${input.findingId}|${input.analysisRunId}`;
    const existing = this.occurrences.get(identity) ?? this.occurrenceRuns.get(sameRun);
    if (existing) return { record: existing, created: false };
    const record: FindingOccurrence = {
      id: `occurrence-${this.occurrences.size + 1}`,
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
      created_at: '2026-01-01T00:00:00.000Z',
    };
    this.occurrences.set(identity, record);
    this.occurrenceRuns.set(sameRun, record);
    return { record, created: true };
  }

  async updateCurrentRisk(_organizationId: string, findingId: string, currentRisk: number): Promise<void> {
    const finding = [...this.findings.values()].find((item) => item.id === findingId);
    if (!finding) throw new Error('Finding not found');
    finding.current_risk = currentRisk;
  }
}

function makeStaticAnalyzer(name: string, analyze: Analyzer['analyze']): Analyzer {
  return {
    metadata: {
      name,
      version: '1.0.0',
      type: 'STRUCTURAL',
      supportedLanguages: ['TypeScript'],
      requiredIR: ['semantic-code-ir'],
      supportedScopes: ['FULL', 'FILE', 'ENTITY', 'IMPACTED'],
      resourceCost: 'LOW',
      supportsIncremental: true,
    },
    analyze,
  };
}

test('analyzer registry lists compatible analyzers and default orchestrator registers built-in analyzer', async () => {
  const registry = new AnalyzerRegistry();
  registry.register(structuralQualityAnalyzer);
  assert.equal(registry.listMatching('TypeScript', ['semantic-code-ir'], 'FULL').length, 1);
  assert.equal(registry.listMatching('TypeScript', ['other-ir'], 'FULL').length, 0);

  const repository = new MemoryFindingRepository();
  const orchestrator = new AnalyzerOrchestrator(
    undefined,
    repository,
    new MemoryEvidenceRepository(),
    new MemoryRiskAssessmentRepository(),
  );
  const result = await orchestrator.execute({
    organizationId: 'org-1',
    repositoryId: 'repo-1',
    commitId: 'commit-1',
    analysisRunId: 'run-default',
    analysisProfileId: 'profile-1',
    analysisProfileVersion: '1',
    analysisScope: { mode: 'FULL' },
    codeIR: { entities: [], relationships: [] },
    sourceAccess: new InMemorySourceAccess(),
    language: 'TypeScript',
  });
  assert.equal(result.results.length, 2);
  assert.deepEqual(result.results.map((item) => item.status), ['COMPLETED', 'COMPLETED']);
});

test('LONG_FUNCTION uses inclusive entity boundaries: 100 does not trigger and 101 does', async () => {
  const context = makeContext();
  const atLimit = await longFunctionRule.evaluate(context, makeEntity({ start_line: 1, end_line: 100 }));
  const overLimit = await longFunctionRule.evaluate(context, makeEntity({ start_line: 1, end_line: 101 }));
  assert.equal(atLimit.findings.length, 0);
  assert.equal(overLimit.findings[0]?.ruleId, 'LONG_FUNCTION');
  assert.equal(overLimit.findings[0]?.evidenceInputs.measuredLineCount, 101);
});

test('HIGH_PARAMETER_COUNT counts declared PARAMETER IR entities at the exact threshold', async () => {
  const fn = makeEntity({ id: 'function', entity_type: 'FUNCTION' });
  for (const [count, expected] of [[7, 0], [8, 1]] as const) {
    const parameters = Array.from({ length: count }, (_, index) =>
      makeEntity({ id: `parameter-${count}-${index}`, entity_type: 'PARAMETER' }));
    const edges = parameters.map((parameter, index) => makeRelationship(fn, parameter, 'DECLARES', `decl-${count}-${index}`));
    const result = await highParameterCountRule.evaluate(makeContext({ entities: [fn, ...parameters], relationships: edges }), fn);
    assert.equal(result.findings.length, expected);
  }
});

test('fan metrics count distinct exact Repository Intelligence CALLS relationships', async () => {
  const target = makeEntity({ id: 'target' });
  for (const [count, expected] of [[15, 0], [16, 1]] as const) {
    const callees = Array.from({ length: count }, (_, index) =>
      makeEntity({ id: `callee-${count}-${index}`, entity_type: 'FUNCTION' }));
    const relationships = callees.map((callee, index) => makeRelationship(target, callee, 'CALLS', `out-${count}-${index}`));
    const context = makeContext({
      entities: [target, ...callees],
      repositoryIntelligence: makeSnapshot([target, ...callees], relationships),
    });
    assert.equal((await highFanOutRule.evaluate(context, target)).findings.length, expected);
  }

  const called = makeEntity({ id: 'called' });
  for (const [count, expected] of [[20, 0], [21, 1]] as const) {
    const callers = Array.from({ length: count }, (_, index) =>
      makeEntity({ id: `caller-${count}-${index}`, entity_type: 'FUNCTION' }));
    const relationships = callers.map((caller, index) => makeRelationship(caller, called, 'CALLS', `in-${count}-${index}`));
    const context = makeContext({
      entities: [called, ...callers],
      repositoryIntelligence: makeSnapshot([called, ...callers], relationships),
    });
    assert.equal((await highFanInRule.evaluate(context, called)).findings.length, expected);
  }
});

test('EMPTY_FUNCTION only flags an explicit no-op body and ignores declaration-only methods', async () => {
  const sourceAccess = new InMemorySourceAccess();
  sourceAccess.setFile('src/empty.ts', 'function empty() {}');
  sourceAccess.setFile('src/abstract.ts', 'abstract run(): void;');
  sourceAccess.setFile('src/object.ts', 'function hasObject() { const value = {}; return value; }');
  sourceAccess.setFile('src/abstract.py', '@abstractmethod\ndef run():\n    pass');
  const empty = makeEntity({ file_path: 'src/empty.ts', start_line: 1, end_line: 1 });
  const abstract = makeEntity({ id: 'abstract', file_path: 'src/abstract.ts', start_line: 1, end_line: 1 });
  const objectBody = makeEntity({ id: 'object', file_path: 'src/object.ts', start_line: 1, end_line: 1 });
  const abstractPython = makeEntity({ id: 'abstract-python', file_path: 'src/abstract.py', start_line: 1, end_line: 3 });
  assert.equal((await emptyFunctionRule.evaluate(makeContext({ sourceAccess }), empty)).findings.length, 1);
  assert.equal((await emptyFunctionRule.evaluate(makeContext({ sourceAccess }), abstract)).findings.length, 0);
  assert.equal((await emptyFunctionRule.evaluate(makeContext({ sourceAccess }), objectBody)).findings.length, 0);
  assert.equal((await emptyFunctionRule.evaluate(makeContext({ sourceAccess }), abstractPython)).findings.length, 0);
  assert.equal((await emptyFunctionRule.evaluate(makeContext(), empty)).unsupported, true);
});

test('empty FILE, ENTITY, and IMPACTED selections never widen to all entities', async () => {
  const entity = makeEntity();
  for (const scope of [
    { mode: 'FILE' as const },
    { mode: 'ENTITY' as const },
    { mode: 'IMPACTED' as const },
  ]) {
    const context = makeContext({ entities: [entity], scope });
    assert.deepEqual(context.getEntitiesForScope(), []);
    const result = await structuralQualityAnalyzer.analyze(context);
    assert.equal(result.status, 'PARTIAL');
    assert.equal(result.metrics.entitiesAnalyzed, 0);
    assert.match(result.diagnostics.join(' '), /no repository-wide fallback/);
  }

  const selectedFile = makeContext({ entities: [entity], scope: { mode: 'FILE', fileIds: ['src/demo.ts'] } });
  assert.deepEqual(selectedFile.getEntitiesForScope(), [entity]);
  assert.deepEqual(makeContext({ entities: [entity], scope: { mode: 'ENTITY', entityIds: [entity.id] } }).getEntitiesForScope(), [entity]);
  assert.deepEqual(makeContext({ entities: [entity], scope: { mode: 'IMPACTED', entityIds: [entity.id] } }).getEntitiesForScope(), [entity]);
  assert.deepEqual(makeContext({ entities: [entity], scope: { mode: 'IMPACTED', fileIds: ['src/demo.ts'] } }).getEntitiesForScope(), [entity]);
  assert.deepEqual(makeContext({ entities: [entity], scope: { mode: 'FULL' } }).getEntitiesForScope(), [entity]);
});

test('entity and file budgets stop analysis, preserve findings, and return partial metrics', async () => {
  const files = new InMemorySourceAccess();
  files.setFile('src/one.ts', 'const value = 1;\n'.repeat(101));
  files.setFile('src/two.ts', 'const value = 1;\n'.repeat(101));
  const first = makeEntity({ id: 'first', file_path: 'src/one.ts', start_line: 1, end_line: 101 });
  const second = makeEntity({ id: 'second', file_path: 'src/two.ts', start_line: 1, end_line: 101 });
  const analyzer = new StructuralQualityAnalyzer([longFunctionRule]);

  const entityLimited = await analyzer.analyze(makeContext({
    entities: [first, second],
    sourceAccess: files,
    maxEntities: 1,
  }));
  assert.equal(entityLimited.status, 'PARTIAL');
  assert.equal(entityLimited.findings.length, 1);
  assert.equal(entityLimited.metrics.entitiesAnalyzed, 1);
  assert.match(entityLimited.diagnostics.join(' '), /maxEntities/);

  const fileLimited = await analyzer.analyze(makeContext({
    entities: [first, second],
    sourceAccess: files,
    maxFiles: 1,
  }));
  assert.equal(fileLimited.status, 'PARTIAL');
  assert.equal(fileLimited.findings.length, 1);
  assert.equal(fileLimited.metrics.filesAnalyzed, 1);
  assert.match(fileLimited.diagnostics.join(' '), /maxFiles/);
});

test('duration budget preserves findings produced before the slow rule completes', async () => {
  const entity = makeEntity({ start_line: 1, end_line: 101 });
  const slowRule: Rule<CodeEntityRecord, AnalyzerContext> = {
    ...longFunctionRule,
    async evaluate(context, target) {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return longFunctionRule.evaluate(context, target);
    },
  };
  const result = await new StructuralQualityAnalyzer([slowRule]).analyze(makeContext({
    entities: [entity],
    maxDurationMs: 1,
  }));
  assert.equal(result.status, 'PARTIAL');
  assert.equal(result.findings.length, 1);
  assert.ok(result.metrics.durationMs >= 1);
  assert.match(result.diagnostics.join(' '), /maxDurationMs/);
});

test('occurrence persistence is idempotent across retries while preserving finding disposition', async () => {
  const repository = new MemoryFindingRepository();
  const sourceAccess = new InMemorySourceAccess();
  sourceAccess.setFile('src/long.ts', 'const value = 1;\n'.repeat(101));
  const entity = makeEntity({
    id: 'long',
    qualified_name: 'src/long.ts::long',
    file_path: 'src/long.ts',
    start_line: 1,
    end_line: 101,
  });
  const registry = new AnalyzerRegistry();
  registry.register(new StructuralQualityAnalyzer([longFunctionRule]));
  const evidence = new MemoryEvidenceRepository();
  const risks = new MemoryRiskAssessmentRepository();
  const orchestrator = new AnalyzerOrchestrator(registry, repository, evidence, risks);
  const input = {
    organizationId: 'org-1',
    repositoryId: 'repo-1',
    commitId: 'commit-1',
    analysisRunId: 'run-1',
    analysisProfileId: 'profile-1',
    analysisProfileVersion: '1',
    analysisScope: { mode: 'FULL' as const },
    codeIR: { entities: [entity], relationships: [] },
    sourceAccess,
    language: 'TypeScript',
  };
  const first = await orchestrator.execute(input);
  const existingFinding = repository.findings.values().next().value as Finding;
  existingFinding.lifecycle = 'CONFIRMED';
  existingFinding.accepted_risk = true;
  const replay = await orchestrator.execute({ ...input, analysisRunId: 'run-2' });
  const nextCommitEntity = makeEntity({
    id: 'long',
    commit_id: 'commit-2',
    qualified_name: 'src/long.ts::long',
    file_path: 'src/long.ts',
    start_line: 1,
    end_line: 101,
  });
  await orchestrator.execute({
    ...input,
    commitId: 'commit-2',
    analysisRunId: 'run-3',
    codeIR: { entities: [nextCommitEntity], relationships: [] },
  });

  assert.deepEqual(replay.findingIds, first.findingIds);
  assert.equal(repository.findings.size, 1);
  assert.equal(repository.occurrences.size, 2);
  assert.equal(evidence.graphs.size, 2);
  assert.equal(risks.assessments.size, 2);
  assert.equal(existingFinding.lifecycle, 'CONFIRMED');
  assert.equal(existingFinding.accepted_risk, true);
  assert.deepEqual(
    [...repository.occurrences.values()].map((occurrence) => occurrence.match_result),
    ['NEW', 'SAME'],
  );
  assert.ok([...repository.occurrences.values()].every((occurrence) => occurrence.observation === 'DETECTED'));
});

test('orchestrator records UNKNOWN when a candidate has no stable semantic or file identity', async () => {
  const repository = new MemoryFindingRepository();
  const candidateEntity = makeEntity({ id: 'unknown-target', qualified_name: null, file_path: null });
  const analyzer = makeStaticAnalyzer('unknown-identity-analyzer', async (context) => {
    const candidate = createFindingCandidate(context as AnalyzerContext, candidateEntity, { id: 'UNKNOWN_RULE', version: '1' }, {
      title: 'Unknown identity',
      description: 'No stable target is available.',
      severity: 'LOW',
      evidenceInputs: {},
      fingerprintInputs: {},
    });
    const result: AnalyzerResult = {
      status: 'COMPLETED',
      findings: [{ ...candidate, semanticTarget: null, file: null }],
      diagnostics: [],
      metrics: { durationMs: 0, filesAnalyzed: 0, entitiesAnalyzed: 1, rulesExecuted: 1, findingsProduced: 1 },
    };
    return result;
  });
  const registry = new AnalyzerRegistry();
  registry.register(analyzer);

  await new AnalyzerOrchestrator(
    registry,
    repository,
    new MemoryEvidenceRepository(),
    new MemoryRiskAssessmentRepository(),
  ).execute({
    organizationId: 'org-1',
    repositoryId: 'repo-1',
    commitId: 'commit-1',
    analysisRunId: 'run-unknown',
    analysisProfileId: 'profile-1',
    analysisProfileVersion: '1',
    analysisScope: { mode: 'FULL' },
    codeIR: { entities: [candidateEntity], relationships: [] },
    sourceAccess: new InMemorySourceAccess(),
    language: 'TypeScript',
  });

  assert.equal([...repository.occurrences.values()][0].match_result, 'UNKNOWN');
});

test('analyzer failures are isolated and do not discard previously persisted analyzer results', async () => {
  const repository = new MemoryFindingRepository();
  const candidateEntity = makeEntity({ id: 'candidate', start_line: 1, end_line: 101 });
  const successAnalyzer = makeStaticAnalyzer('successful-analyzer', async (context) => {
    const analyzerContext = context as AnalyzerContext;
    const finding = createFindingCandidate(analyzerContext, candidateEntity, { id: 'TEST_RULE', version: '1' }, {
      title: 'Test finding',
      description: 'Test finding description',
      severity: 'LOW',
      evidenceInputs: {},
      fingerprintInputs: {},
    });
    const result: AnalyzerResult = {
      status: 'COMPLETED',
      findings: [finding],
      diagnostics: [],
      metrics: { durationMs: 0, filesAnalyzed: 1, entitiesAnalyzed: 1, rulesExecuted: 1, findingsProduced: 1 },
    };
    return result;
  });
  const failingAnalyzer = makeStaticAnalyzer('failing-analyzer', async () => {
    throw new Error('expected analyzer failure');
  });
  const registry = new AnalyzerRegistry();
  registry.register(successAnalyzer);
  registry.register(failingAnalyzer);

  const result = await new AnalyzerOrchestrator(
    registry,
    repository,
    new MemoryEvidenceRepository(),
    new MemoryRiskAssessmentRepository(),
  ).execute({
    organizationId: 'org-1',
    repositoryId: 'repo-1',
    commitId: 'commit-1',
    analysisRunId: 'run-failure-isolation',
    analysisProfileId: 'profile-1',
    analysisProfileVersion: '1',
    analysisScope: { mode: 'FULL' },
    codeIR: { entities: [candidateEntity], relationships: [] },
    sourceAccess: new InMemorySourceAccess(),
    language: 'TypeScript',
  });
  assert.deepEqual(result.results.map((analyzerResult) => analyzerResult.status), ['COMPLETED', 'FAILED']);
  assert.equal(repository.findings.size, 1);
  assert.equal(repository.occurrences.size, 1);
  assert.match(result.results[1].diagnostics[0], /expected analyzer failure/);
});

test('risk persistence failure preserves findings and evidence while reporting a partial result', async () => {
  const repository = new MemoryFindingRepository();
  const candidateEntity = makeEntity({ id: 'risk-target', file_path: 'src/demo.ts', start_line: 1, end_line: 101 });
  const analyzer = makeStaticAnalyzer('risk-persistence-test', async (context) => {
    const candidate = createFindingCandidate(context as AnalyzerContext, candidateEntity, { id: 'RISK_TEST', version: '1' }, {
      title: 'Risk persistence fixture',
      description: 'Verifies isolation of risk persistence failure.',
      severity: 'HIGH',
      evidenceInputs: {},
      fingerprintInputs: {},
    });
    return {
      status: 'COMPLETED',
      findings: [candidate],
      diagnostics: [],
      metrics: { durationMs: 0, filesAnalyzed: 1, entitiesAnalyzed: 1, rulesExecuted: 1, findingsProduced: 1 },
    };
  });
  const registry = new AnalyzerRegistry();
  registry.register(analyzer);
  const evidence = new MemoryEvidenceRepository();
  const result = await new AnalyzerOrchestrator(
    registry,
    repository,
    evidence,
    { async createOrGet() { throw new Error('risk storage unavailable'); } },
  ).execute({
    organizationId: 'org-1',
    repositoryId: 'repo-1',
    commitId: 'commit-1',
    analysisRunId: 'risk-persistence-failure',
    analysisProfileId: 'profile-1',
    analysisProfileVersion: '1',
    analysisScope: { mode: 'FULL' },
    codeIR: { entities: [candidateEntity], relationships: [] },
    sourceAccess: new InMemorySourceAccess(),
    language: 'TypeScript',
  });

  assert.equal(result.results[0]?.status, 'PARTIAL');
  assert.match(result.results[0]?.diagnostics.join(' ') ?? '', /risk storage unavailable/);
  assert.equal(repository.findings.size, 1);
  assert.equal(repository.occurrences.size, 1);
  assert.equal(evidence.graphs.size, 1);
  assert.equal([...repository.findings.values()][0]?.current_risk, 75);
  assert.equal(result.riskMetrics.failures, 1);
});
