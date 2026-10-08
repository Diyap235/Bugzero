import test from 'node:test';
import assert from 'node:assert/strict';

import type { HealthProfile } from '@bugzero/contracts';
import { HealthSnapshotSchema, HealthProfileSchema } from '@bugzero/contracts';
import { HealthRepository, type HealthSnapshot } from '@bugzero/database';
import { RepositoryHealthEngine, defaultHealthProfile, type RepositoryHealthInput } from '../src/health/health-engine.js';
import { MemoryHealthRepository } from './support/memory-health-repository.js';

const baseInput: RepositoryHealthInput = {
  organizationId: '11111111-1111-4111-8111-111111111111',
  repositoryId: '22222222-2222-4222-8222-222222222222',
  commitId: '33333333-3333-4333-8333-333333333333',
  analysisRunId: '44444444-4444-4444-8444-444444444444',
  findings: [],
  analyzerStatuses: { security: 'COMPLETED', quality: 'COMPLETED', maintainability: 'COMPLETED' },
  upstreamComplete: true,
  sourceFileCount: 4,
  parsedFileCount: 4,
};

function finding(overrides: Partial<RepositoryHealthInput['findings'][number]> = {}): RepositoryHealthInput['findings'][number] {
  return {
    findingId: 'finding-1',
    occurrenceId: 'occurrence-1',
    ruleId: 'SECURITY.SQL_INJECTION',
    category: 'SECURITY',
    severity: 'HIGH',
    confidence: 'HIGH',
    technicalRisk: 80,
    riskBand: 'CRITICAL',
    evidenceAuthority: 'AUTHORITATIVE',
    evidenceCompleteness: 'COMPLETE',
    ...overrides,
  };
}

test('empty repository scores only completed analyzer dimensions and keeps unsupported dimensions unknown', () => {
  const result = new RepositoryHealthEngine().assess(baseInput);
  assert.equal(result.dimensions.security.score, 100);
  assert.equal(result.dimensions.quality.score, 100);
  assert.equal(result.dimensions.dependencies.score, null);
  assert.equal(result.dimensions.reliability.score, null);
  assert.equal(result.dimensions.maintainability.score, 100);
  assert.equal(result.coverage, 'PARTIAL');
  assert.equal(result.overallStatus, 'EXCELLENT');
});

test('security findings reduce security health using persisted risk and report actual metrics', () => {
  const result = new RepositoryHealthEngine().assess({
    ...baseInput,
    findings: [finding()],
  });
  assert.equal(result.dimensions.security.score, 84);
  assert.equal(result.dimensions.security.inputMetrics.findingCount, 1);
  assert.equal(result.dimensions.security.inputMetrics.highRiskFindings, 1);
  assert.equal(result.dimensions.security.inputMetrics.totalTechnicalRisk, 80);
  assert.equal(result.dimensions.security.confidence, 100);
});

test('quality findings use the quality-specific severity penalty schedule', () => {
  const result = new RepositoryHealthEngine().assess({
    ...baseInput,
    findings: [finding({ category: 'QUALITY', ruleId: 'LONG_FUNCTION', severity: 'HIGH', technicalRisk: 100, riskBand: 'CRITICAL' })],
  });
  assert.equal(result.dimensions.quality.score, 88);
  assert.equal(result.dimensions.quality.inputMetrics.findingCount, 1);
});

test('supported structural signals produce a separate maintainability dimension', () => {
  const result = new RepositoryHealthEngine().assess({
    ...baseInput,
    findings: [finding({
      category: 'MAINTAINABILITY',
      ruleId: 'LONG_FUNCTION',
      technicalRisk: 100,
      riskBand: 'CRITICAL',
    })],
  });
  assert.equal(result.dimensions.maintainability.score, 85);
  assert.equal(result.dimensions.maintainability.inputMetrics.findingCount, 1);
  assert.equal(result.dimensions.reliability.score, null);
});

test('multiple severities aggregate deterministically and severity counts are retained', () => {
  const result = new RepositoryHealthEngine().assess({
    ...baseInput,
    findings: [
      finding({ severity: 'LOW', technicalRisk: 100, occurrenceId: 'low' }),
      finding({ severity: 'MEDIUM', technicalRisk: 100, occurrenceId: 'medium' }),
      finding({ severity: 'CRITICAL', technicalRisk: 100, occurrenceId: 'critical', riskBand: 'CRITICAL' }),
    ],
  });
  assert.equal(result.dimensions.security.score, 50);
  assert.deepEqual(result.dimensions.security.inputMetrics.severityCounts, {
    INFO: 0, LOW: 1, MEDIUM: 1, HIGH: 0, CRITICAL: 1,
  });
});

test('risk aggregation changes health without recomputing finding risk', () => {
  const engine = new RepositoryHealthEngine();
  const lower = engine.assess({ ...baseInput, findings: [finding({ technicalRisk: 20, riskBand: 'LOW' })] });
  const higher = engine.assess({ ...baseInput, findings: [finding({ technicalRisk: 80, riskBand: 'CRITICAL' })] });
  assert.ok((lower.dimensions.security.score ?? 0) > (higher.dimensions.security.score ?? 100));
});

test('partial analysis retains a partial score only for the evaluated dimension', () => {
  const result = new RepositoryHealthEngine().assess({
    ...baseInput,
    analyzerStatuses: { security: 'PARTIAL', quality: 'COMPLETED', maintainability: 'COMPLETED' },
    upstreamComplete: false,
    findings: [finding()],
  });
  assert.equal(result.dimensions.security.coverage, 'PARTIAL');
  assert.equal(result.dimensions.security.score, 84);
  assert.equal(result.coverage, 'PARTIAL');
});

test('unrun analyzer leaves its dimension unknown rather than healthy or unhealthy', () => {
  const result = new RepositoryHealthEngine().assess({
    ...baseInput,
    analyzerStatuses: { security: 'UNKNOWN', quality: 'COMPLETED', maintainability: 'COMPLETED' },
  });
  assert.equal(result.dimensions.security.status, 'UNKNOWN');
  assert.equal(result.dimensions.security.score, null);
  assert.equal(result.dimensions.security.coverage, 'UNKNOWN');
});

test('no analyzers leaves the overall score unknown instead of inventing a repository score', () => {
  const result = new RepositoryHealthEngine().assess({
    ...baseInput,
    analyzerStatuses: { security: 'UNKNOWN', quality: 'UNKNOWN', maintainability: 'UNKNOWN' },
    upstreamComplete: false,
  });
  assert.equal(result.overallScore, null);
  assert.equal(result.overallStatus, 'UNKNOWN');
  assert.equal(result.coverage, 'UNKNOWN');
});

test('dependency health is unknown when dependency vulnerability analysis is unavailable', () => {
  const result = new RepositoryHealthEngine().assess(baseInput);
  assert.equal(result.dimensions.dependencies.status, 'UNKNOWN');
  assert.equal(result.dimensions.dependencies.score, null);
  assert.match(result.dimensions.dependencies.explanation, /not implemented/);
});

test('zero LOC and unavailable LOC density do not produce NaN or Infinity', () => {
  const result = new RepositoryHealthEngine().assess({
    ...baseInput,
    sourceFileCount: 0,
    parsedFileCount: 0,
    findings: [finding()],
  });
  const metrics = result.dimensions.security.inputMetrics;
  assert.equal(metrics.codeLinesOfCode, null);
  assert.equal(metrics.findingsPer1000Lines, null);
  for (const dimension of Object.values(result.dimensions)) {
    assert.ok(dimension.score === null || Number.isFinite(dimension.score));
    assert.ok(dimension.confidence === null || Number.isFinite(dimension.confidence));
  }
  assert.ok(result.overallScore === null || Number.isFinite(result.overallScore));
});

test('no findings after completed security and quality analysis produces 100 for those dimensions', () => {
  const result = new RepositoryHealthEngine().assess(baseInput);
  assert.equal(result.dimensions.security.score, 100);
  assert.equal(result.dimensions.quality.score, 100);
  assert.match(result.dimensions.security.explanation, /No security findings/);
});

test('critical findings apply the configured critical severity penalty', () => {
  const result = new RepositoryHealthEngine().assess({
    ...baseInput,
    findings: [finding({ severity: 'CRITICAL', technicalRisk: 100 })],
  });
  assert.equal(result.dimensions.security.score, 65);
  assert.equal(result.dimensions.security.status, 'FAIR');
});

test('multiple findings accumulate and duplicate occurrence signals are counted once', () => {
  const first = finding({ occurrenceId: 'same' });
  const duplicate = finding({ occurrenceId: 'same', findingId: 'other' });
  const second = finding({ occurrenceId: 'second' });
  const result = new RepositoryHealthEngine().assess({
    ...baseInput,
    findings: [first, duplicate, second],
  });
  assert.equal(result.dimensions.security.inputMetrics.findingCount, 2);
  assert.equal(result.calculation.findingsCount, 2);
  assert.equal(result.dimensions.security.score, 68);
});

test('explanations and all calculation outputs are deterministic', () => {
  const engine = new RepositoryHealthEngine();
  const first = engine.assess({ ...baseInput, findings: [finding()] });
  const second = engine.assess({ ...baseInput, findings: [finding()] });
  assert.deepEqual(first, second);
  assert.match(first.explanation, /coverage is PARTIAL/);
  assert.match(first.dimensions.security.explanation, /1 security finding/);
});

test('profile identity and version are preserved for replayable scoring', () => {
  const profile: HealthProfile = { ...defaultHealthProfile, id: 'health-v2', version: 2 };
  const result = new RepositoryHealthEngine(profile).assess(baseInput);
  assert.equal(result.profile.id, 'health-v2');
  assert.equal(result.profile.version, 2);
});

test('health bands use the configured inclusive score boundaries', () => {
  const expected: Array<[number, string]> = [
    [100, 'EXCELLENT'], [90, 'EXCELLENT'], [89, 'GOOD'], [75, 'GOOD'],
    [74, 'FAIR'], [60, 'FAIR'], [59, 'POOR'], [40, 'POOR'], [39, 'CRITICAL'], [0, 'CRITICAL'],
  ];
  for (const [score, band] of expected) {
    const profile: HealthProfile = {
      ...defaultHealthProfile,
      severityPenalty: {
        security: { ...defaultHealthProfile.severityPenalty.security, HIGH: 100 - score },
        quality: defaultHealthProfile.severityPenalty.quality,
        maintainability: defaultHealthProfile.severityPenalty.maintainability,
      },
    };
    const result = new RepositoryHealthEngine(profile).assess({
      ...baseInput,
      findings: [finding({ technicalRisk: 100 })],
    });
    assert.equal(result.dimensions.security.status, band);
  }
});

test('missing persisted risk leaves the affected dimension unscored and partial', () => {
  const result = new RepositoryHealthEngine().assess({
    ...baseInput,
    findings: [finding({ technicalRisk: null, riskBand: null })],
  });
  assert.equal(result.dimensions.security.score, null);
  assert.equal(result.dimensions.security.status, 'PARTIAL');
  assert.equal(result.dimensions.security.coverage, 'PARTIAL');
  assert.match(result.dimensions.security.explanation, /lack a persisted risk assessment/);
});

test('incomplete or non-authoritative evidence lowers evidence coverage confidence', () => {
  const result = new RepositoryHealthEngine().assess({
    ...baseInput,
    findings: [finding({ evidenceAuthority: 'INVESTIGATIVE', evidenceCompleteness: 'PARTIAL' })],
  });
  assert.equal(result.dimensions.security.confidence, 0);
});

test('health snapshot persistence is idempotent for a commit and preserves a new commit history', async () => {
  const engine = new RepositoryHealthEngine();
  const repository = new MemoryHealthRepository();
  const first = engine.assess({ ...baseInput, findings: [finding()] });
  const persist = (commitId: string, assessment: typeof first) => repository.createOrGetSnapshot({
    organizationId: baseInput.organizationId,
    repositoryId: baseInput.repositoryId,
    commitId,
    analysisRunId: baseInput.analysisRunId,
    profileId: assessment.profile.id,
    profileVersion: assessment.profile.version,
    modelVersion: assessment.profile.modelVersion,
    overallScore: assessment.overallScore,
    overallStatus: assessment.overallStatus,
    coverage: assessment.coverage,
    dimensions: assessment.dimensions,
    profileSnapshot: { ...assessment.profile },
    calculation: assessment.calculation,
    explanation: assessment.explanation,
    securityScore: assessment.dimensions.security.score,
    qualityScore: assessment.dimensions.quality.score,
    reliabilityScore: assessment.dimensions.reliability.score,
    maintainabilityScore: assessment.dimensions.maintainability.score,
    dependencyScore: assessment.dimensions.dependencies.score,
  });
  const initial = await persist('commit-1', first);
  const replay = await persist('commit-1', first);
  const nextCommit = await persist('commit-2', first);
  assert.equal(initial.created, true);
  assert.equal(replay.created, false);
  assert.equal(replay.record.id, initial.record.id);
  assert.equal(nextCommit.created, true);
  assert.notEqual(nextCommit.record.id, initial.record.id);
  assert.equal(repository.snapshots.size, 2);
  assert.equal(initial.record.commit_id, 'commit-1');
});

test('health profile and snapshot contracts accept unknown dimensions without numeric placeholders', () => {
  const assessment = new RepositoryHealthEngine().assess(baseInput);
  const profileParsed = HealthProfileSchema.safeParse(assessment.profile);
  assert.equal(profileParsed.success, true, JSON.stringify(profileParsed.error?.issues));
  const parsedSnapshot = HealthSnapshotSchema.safeParse({
    id: '11111111-1111-4111-8111-111111111111',
    organizationId: baseInput.organizationId,
    repositoryId: '22222222-2222-4222-8222-222222222222',
    commitId: '33333333-3333-4333-8333-333333333333',
    analysisRunId: baseInput.analysisRunId,
    profileId: assessment.profile.id,
    profileVersion: assessment.profile.version,
    overallScore: assessment.overallScore,
    overallStatus: assessment.overallStatus,
    coverage: assessment.coverage,
    dimensions: assessment.dimensions,
    securityScore: assessment.dimensions.security.score,
    qualityScore: assessment.dimensions.quality.score,
    reliabilityScore: assessment.dimensions.reliability.score,
    maintainabilityScore: assessment.dimensions.maintainability.score,
    dependencyScore: assessment.dimensions.dependencies.score,
    calculation: assessment.calculation,
    explanation: assessment.explanation,
    createdAt: new Date(0).toISOString(),
  });
  assert.equal(parsedSnapshot.success, true);
  const legacyParsed = HealthSnapshotSchema.safeParse({
    id: '11111111-1111-4111-8111-111111111111',
    organizationId: baseInput.organizationId,
    repositoryId: '22222222-2222-4222-8222-222222222222',
    commitSha: 'a'.repeat(40),
    securityScore: 90,
    qualityScore: 90,
    reliabilityScore: 90,
    maintainabilityScore: 90,
    dependencyScore: 90,
    createdAt: new Date(0).toISOString(),
  });
  assert.equal(legacyParsed.success, true);
});

test('database health repository resolves an idempotent profile/revision conflict to the existing snapshot', async () => {
  const queries: Array<{ text: string; values: unknown[] }> = [];
  const record: HealthSnapshot = {
    id: 'health-existing',
    organization_id: baseInput.organizationId,
    repository_id: baseInput.repositoryId,
    commit_id: baseInput.commitId,
    analysis_run_id: baseInput.analysisRunId,
    profile_id: defaultHealthProfile.id,
    profile_version: defaultHealthProfile.version,
    model_version: defaultHealthProfile.modelVersion,
    overall_score: 91,
    overall_status: 'EXCELLENT',
    coverage: 'PARTIAL',
    dimensions: {},
    profile_snapshot: {},
    calculation: {},
    explanation: 'Existing deterministic health assessment.',
    security_score: 90,
    quality_score: 92,
    reliability_score: null,
    maintainability_score: 91,
    dependency_score: null,
    created_at: new Date(0).toISOString(),
  };
  const pool = {
    async query(text: string, values: unknown[] = []) {
      queries.push({ text, values });
      return { rows: queries.length === 1 ? [] : [record] };
    },
  } as unknown as ConstructorParameters<typeof HealthRepository>[0];
  const repository = new HealthRepository(pool);
  const assessment = new RepositoryHealthEngine().assess(baseInput);
  const result = await repository.createOrGetSnapshot({
    organizationId: baseInput.organizationId,
    repositoryId: baseInput.repositoryId,
    commitId: baseInput.commitId,
    analysisRunId: baseInput.analysisRunId,
    profileId: assessment.profile.id,
    profileVersion: assessment.profile.version,
    modelVersion: assessment.profile.modelVersion,
    overallScore: assessment.overallScore,
    overallStatus: assessment.overallStatus,
    coverage: assessment.coverage,
    dimensions: assessment.dimensions,
    profileSnapshot: { ...assessment.profile },
    calculation: assessment.calculation,
    explanation: assessment.explanation,
    securityScore: assessment.dimensions.security.score,
    qualityScore: assessment.dimensions.quality.score,
    reliabilityScore: assessment.dimensions.reliability.score,
    maintainabilityScore: assessment.dimensions.maintainability.score,
    dependencyScore: assessment.dimensions.dependencies.score,
  });
  assert.equal(result.created, false);
  assert.equal(result.record.id, record.id);
  assert.match(queries[0]?.text ?? '', /ON CONFLICT \(organization_id, repository_id, commit_id, profile_id, profile_version\)/);
  assert.match(queries[1]?.text ?? '', /profile_id = \$4 AND profile_version = \$5/);
  assert.deepEqual(queries[1]?.values, [
    baseInput.organizationId,
    baseInput.repositoryId,
    baseInput.commitId,
    defaultHealthProfile.id,
    defaultHealthProfile.version,
  ]);
});

test('invalid score inputs are rejected rather than persisted as fake health', () => {
  assert.throws(() => new RepositoryHealthEngine().assess({
    ...baseInput,
    sourceFileCount: -1,
  }), /file counts must be nonnegative integers/);
  assert.throws(() => new RepositoryHealthEngine().assess({
    ...baseInput,
    findings: [finding({ technicalRisk: Number.NaN })],
  }), /Invalid risk score/);
});
