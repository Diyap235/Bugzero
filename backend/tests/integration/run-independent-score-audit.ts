import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import {
  AnalysisRepository,
  EvidenceRepository,
  FindingRepository,
  HealthRepository,
  MemberRepository,
  RepositoryRepository,
  RiskAssessmentRepository,
  UserRepository,
  getDatabasePool,
  withOrganizationContext,
} from '@bugzero/database';
import { createAnalysisQueueWorker } from '@bugzero/workers/analysis-queue';
import { AnalysisJobProcessor } from '@bugzero/workers/analysis-processor';
import { createSignedTokenAuthenticator } from '../../src/auth/signed-token.js';
import { createApiServer } from '../../src/server.js';

type FixtureCase = {
  name: string;
  language: string;
  category: string;
  expected_behavior: string;
  notes: string;
};

type AuditCase = Record<string, unknown> & {
  caseId: string;
  expected: FixtureCase;
  runStatus: string | null;
  jobStatus: string | null;
  findings: unknown[];
  evidenceRecords: unknown[];
  persistedRiskAssessments: Array<Record<string, unknown>>;
  independentRiskScores: Array<Record<string, unknown>>;
  riskApiMatches: Array<Record<string, unknown>>;
  riskApiValues: Array<{ id: string; technical_risk: number }>;
  error: string | null;
  auditStatus: string;
};

function record(value: unknown): Record<string, any> {
  return typeof value === 'object' && value !== null ? value as Record<string, any> : {};
}

function signedToken(privateKey: ReturnType<typeof generateKeyPairSync>['privateKey'], userId: string, organizationId: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'EdDSA', typ: 'JWT' })).toString('base64url');
  const claims = Buffer.from(JSON.stringify({
    sub: userId,
    org: organizationId,
    iss: 'bugzero-score-audit',
    aud: 'bugzero-api',
    iat: now,
    exp: now + 86_400,
  })).toString('base64url');
  const content = `${header}.${claims}`;
  return `${content}.${sign(null, Buffer.from(content), privateKey).toString('base64url')}`;
}

function scoreRisk(assessment: Record<string, any>): number | null {
  const profile = record(assessment.profile_snapshot);
  const severityBase = record(profile.severityBase);
  const adjustments = record(profile.adjustments);
  const dimensions = [
    ['confidence', assessment.confidence],
    ['evidenceStrength', assessment.evidence_strength],
    ['evidenceAuthority', assessment.evidence_authority],
    ['evidenceSufficiency', assessment.evidence_sufficiency],
    ['evidenceCompleteness', assessment.evidence_completeness],
    ['reachability', assessment.reachability],
    ['exploitability', assessment.exploitability],
  ] as const;
  if (typeof severityBase[assessment.severity] !== 'number') return null;
  let value = severityBase[assessment.severity] as number;
  for (const [dimension, input] of dimensions) {
    const adjustment = record(adjustments[dimension])[input];
    if (typeof adjustment !== 'number') return null;
    value += adjustment;
  }
  return Math.max(0, Math.min(100, value));
}

function scoreHealth(snapshot: Record<string, any>): { score: number | null; dimensions: Record<string, number | null> } {
  const profile = record(snapshot.profile_snapshot);
  const weights = record(profile.dimensionWeights);
  const penalties = record(profile.severityPenalty);
  const riskScale = typeof profile.riskScale === 'number' ? profile.riskScale : null;
  const dimensions = record(snapshot.dimensions);
  const scores: Record<string, number | null> = {};
  let weightedTotal = 0;
  let availableWeight = 0;
  for (const name of ['security', 'quality', 'maintainability']) {
    const dimension = record(dimensions[name]);
    const inputs = record(dimension.inputMetrics);
    const findingCount = Number(inputs.findingCount);
    const persistedScore = typeof dimension.score === 'number' ? dimension.score : null;
    let independentlyScored: number | null = null;
    if (persistedScore !== null && findingCount === 0) independentlyScored = 100;
    else if (persistedScore !== null && findingCount > 0 && riskScale && typeof inputs.totalTechnicalRisk === 'number') {
      const severityCounts = record(inputs.severityCounts);
      const dimensionPenalties = record(penalties[name]);
      const severityPenalty = Object.entries(severityCounts).reduce((total, [severity, count]) => {
        const penalty = dimensionPenalties[severity];
        return total + (typeof penalty === 'number' && typeof count === 'number'
          ? penalty * count * inputs.totalTechnicalRisk / findingCount / riskScale
          : 0);
      }, 0);
      independentlyScored = Math.max(0, Math.min(100, Math.round(100 - severityPenalty)));
    }
    scores[name] = independentlyScored;
    if (independentlyScored !== null && persistedScore !== null && typeof weights[name] === 'number' && weights[name] > 0) {
      weightedTotal += independentlyScored * weights[name];
      availableWeight += weights[name];
    }
  }
  return { score: availableWeight ? Math.round(weightedTotal / availableWeight) : null, dimensions: scores };
}

function classify(item: AuditCase): string {
  if (item.error || item.jobStatus !== 'COMPLETED' || !item.runStatus) return 'UNVERIFIED';
  const findings = item.findings.length;
  const risks = item.persistedRiskAssessments.length;
  if (item.expected.expected_behavior === 'VULNERABLE_SQLI') {
    const hasSupportedFinding = item.findings.some((finding) => hasAuthoritativeEvidence(item, finding));
    if (findings && (!risks || !hasSupportedFinding)) return 'PERSISTENCE_FAILURE';
    if (findings && risks) return 'DETECTED';
    if (item.runStatus === 'PARTIAL') return 'UNSUPPORTED_PARTIAL';
    return 'MISSED_DETECTION';
  }
  if (item.expected.expected_behavior === 'SAFE_SQL') {
    if (findings) return 'FALSE_POSITIVE';
    if (item.runStatus === 'PARTIAL') return 'UNSUPPORTED_PARTIAL';
    return 'CORRECTLY_SAFE';
  }
  return item.runStatus === 'PARTIAL' ? 'UNSUPPORTED_PARTIAL' : 'UNSUPPORTED_OR_DEFERRED';
}

function updateClassification(item: AuditCase): void {
  item.auditStatus = classify(item);
  if (item.auditStatus === 'UNVERIFIED') {
    item.unverifiedReason = 'Run or job did not reach a verifiable terminal state.';
  } else if (item.auditStatus === 'UNSUPPORTED_PARTIAL') {
    item.unverifiedReason = 'The analysis completed with explicit partial coverage; this is not a clean or score-certified result.';
  } else if (item.auditStatus === 'UNSUPPORTED_OR_DEFERRED') {
    item.unverifiedReason = 'Fixture category is outside the SQL-injection analyzer contract.';
  } else {
    delete item.unverifiedReason;
  }
}

function isValidGroundTruth(item: AuditCase): boolean {
  return item.expected.expected_behavior === 'VULNERABLE_SQLI'
    || item.expected.expected_behavior === 'SAFE_SQL';
}

function hasAuthoritativeEvidence(item: AuditCase, finding: unknown): boolean {
  const findingId = record(finding).findingId;
  return typeof findingId === 'string' && item.evidenceRecords.some((candidate) => {
    const evidence = record(candidate);
    return evidence.findingId === findingId
      && evidence.authority === 'AUTHORITATIVE'
      && evidence.sufficiency === 'SUFFICIENT'
      && evidence.completeness === 'COMPLETE';
  });
}

function calculateGroundTruthMetrics(cases: AuditCase[]) {
  const labeledCases = cases.filter(isValidGroundTruth);
  const eligibleCases = labeledCases.filter((item) =>
    item.findings.some((finding) => hasAuthoritativeEvidence(item, finding))
    || (item.runStatus === 'COMPLETED' && item.findings.length === 0));
  const actualPositive = (item: AuditCase) =>
    item.findings.some((finding) => hasAuthoritativeEvidence(item, finding));
  const truePositives = eligibleCases.filter((item) =>
    item.expected.expected_behavior === 'VULNERABLE_SQLI' && actualPositive(item)).length;
  const falseNegatives = eligibleCases.filter((item) =>
    item.expected.expected_behavior === 'VULNERABLE_SQLI' && !actualPositive(item)).length;
  const falsePositives = eligibleCases.filter((item) =>
    item.expected.expected_behavior === 'SAFE_SQL' && actualPositive(item)).length;
  const trueNegatives = eligibleCases.filter((item) =>
    item.expected.expected_behavior === 'SAFE_SQL' && !actualPositive(item)).length;
  const precision = truePositives + falsePositives > 0
    ? truePositives / (truePositives + falsePositives)
    : null;
  const recall = truePositives + falseNegatives > 0
    ? truePositives / (truePositives + falseNegatives)
    : null;
  const f1 = precision !== null && recall !== null && precision + recall > 0
    ? 2 * precision * recall / (precision + recall)
    : null;
  return {
    groundTruthCases: eligibleCases.length,
    excludedIncompleteGroundTruthCases: labeledCases.length - eligibleCases.length,
    truePositives,
    falsePositives,
    trueNegatives,
    falseNegatives,
    precision,
    recall,
    f1,
  };
}

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

async function persistArtifacts(cases: AuditCase[], metadata: Record<string, unknown>): Promise<void> {
  const reportId = String(metadata.startedAt ?? Date.now()).replace(/[^0-9A-Za-z-]/g, '-');
  const output = new URL(`../../../bugzero-50-independent-results/fresh-${reportId}/`, import.meta.url);
  await mkdir(output, { recursive: true });
  const isTerminal = (status: string | null) =>
    status === 'COMPLETED' || status === 'FAILED' || status === 'DEAD_LETTER' || status === 'CANCELLED';
  const expectedCaseCount = Number(metadata.manifestCaseCount ?? cases.length);
  const complete = cases.length === expectedCaseCount && cases.every((item) => isTerminal(item.jobStatus));
  const count = (name: string) => cases.filter((item) => item.auditStatus === name).length;
  const scoreComparisons = cases.filter((item) => typeof item.persistedHealthScore === 'number');
  const healthMatches = scoreComparisons.filter((item) => item.healthScoreMatch === true).length;
  const healthApiComparisons = cases.filter((item) => typeof item.persistedHealthScore === 'number'
    && typeof item.healthApiScore === 'number');
  const healthApiMatches = healthApiComparisons.filter((item) => item.healthApiScoreMatch === true).length;
  const riskComparisons = cases.flatMap((item) => item.independentRiskScores)
    .filter((item) => typeof item.persisted === 'number');
  const riskMatches = riskComparisons.filter((item) => item.matches === true).length;
  const riskApiComparisons = cases.flatMap((item) => item.riskApiMatches);
  const riskApiMatches = riskApiComparisons.filter((item) => item.matches === true).length;
  const groundTruthMetrics = calculateGroundTruthMetrics(cases);
  const summary = {
    fixture: 'bugzero-50-file-audit-fixture',
    manifestCaseCount: expectedCaseCount,
    attemptedRuns: cases.length,
    terminalRuns: cases.filter((item) => isTerminal(item.jobStatus)).length,
    completedJobRuns: cases.filter((item) => item.jobStatus === 'COMPLETED').length,
    completedAnalysisRuns: cases.filter((item) => item.runStatus === 'COMPLETED').length,
    partialAnalysisRuns: cases.filter((item) => item.runStatus === 'PARTIAL').length,
    failedOrDeadLetterRuns: cases.filter((item) => item.runStatus === 'FAILED' || item.jobStatus === 'DEAD_LETTER').length,
    detectedCases: count('DETECTED'),
    correctlySafeCases: count('CORRECTLY_SAFE'),
    unsupportedOrPartialCases: count('UNSUPPORTED_PARTIAL') + count('UNSUPPORTED_OR_DEFERRED'),
    missedDetections: count('MISSED_DETECTION'),
    persistenceFailures: count('PERSISTENCE_FAILURE'),
    falsePositiveCases: count('FALSE_POSITIVE'),
    unverifiedCases: count('UNVERIFIED'),
    healthScoreComparisons: scoreComparisons.length,
    healthScoreMatches: healthMatches,
    healthScoreMismatches: scoreComparisons.length - healthMatches,
    healthApiComparisons: healthApiComparisons.length,
    healthApiMatches,
    healthApiMismatches: healthApiComparisons.length - healthApiMatches,
    riskScoreComparisons: riskComparisons.length,
    riskScoreMatches: riskMatches,
    riskScoreMismatches: riskComparisons.length - riskMatches,
    riskApiComparisons: riskApiComparisons.length,
    riskApiMatches,
    riskApiMismatches: riskApiComparisons.length - riskApiMatches,
    ...groundTruthMetrics,
    ...metadata,
  };
  const fields = [
    'caseId', 'expected_behavior', 'runStatus', 'jobStatus', 'auditStatus',
    'findingsCount', 'evidenceCount', 'riskAssessmentCount',
    'persistedHealthScore', 'independentHealthScore', 'healthApiScore', 'healthScoreMatch',
    'persistedRiskAssessments', 'independentRiskScores', 'riskApiValues', 'error',
  ];
  const rows = cases.map((item) => fields.map((field) => csvCell(
    field === 'expected_behavior' ? item.expected.expected_behavior
      : field === 'findingsCount' ? item.findings.length
        : field === 'evidenceCount' ? item.evidenceRecords.length
          : field === 'riskAssessmentCount' ? item.persistedRiskAssessments.length
            : field === 'persistedRiskAssessments' ? JSON.stringify(item.persistedRiskAssessments)
              : field === 'independentRiskScores' ? JSON.stringify(item.independentRiskScores)
                : field === 'riskApiValues' ? JSON.stringify(item.riskApiValues)
                  : item[field],
  )).join(','));
  await writeFile(new URL('results.json', output), `${JSON.stringify({ summary, cases }, null, 2)}\n`, 'utf8');
  await writeFile(new URL('results.csv', output), `${fields.join(',')}\n${rows.join('\n')}\n`, 'utf8');
  await writeFile(new URL('summary.md', output), [
    '# Independent fixture score audit',
    '',
    `- Cases in unchanged manifest: ${summary.manifestCaseCount}`,
    `- Terminal jobs: ${summary.terminalRuns}/${summary.attemptedRuns}; completed jobs: ${summary.completedJobRuns}`,
    `- Analysis runs: ${summary.completedAnalysisRuns} COMPLETED, ${summary.partialAnalysisRuns} PARTIAL, ${summary.failedOrDeadLetterRuns} FAILED/DEAD_LETTER`,
    `- Detected: ${summary.detectedCases}; correctly safe: ${summary.correctlySafeCases}; unsupported/partial: ${summary.unsupportedOrPartialCases}; missed: ${summary.missedDetections}; persistence failures: ${summary.persistenceFailures}; false-positive cases: ${summary.falsePositiveCases}; unverified: ${summary.unverifiedCases}`,
    `- Health score comparisons: ${summary.healthScoreMatches}/${summary.healthScoreComparisons} matches`,
    `- Health API comparisons: ${summary.healthApiMatches}/${summary.healthApiComparisons} matches`,
    `- Risk score comparisons: ${summary.riskScoreMatches}/${summary.riskScoreComparisons} matches; assessments without persisted inputs are not treated as zero`,
    `- Risk API comparisons: ${summary.riskApiMatches}/${summary.riskApiComparisons} matches`,
    `- Ground-truth cases: ${summary.groundTruthCases}; excluded incomplete: ${summary.excludedIncompleteGroundTruthCases}; TP=${summary.truePositives}, FP=${summary.falsePositives}, TN=${summary.trueNegatives}, FN=${summary.falseNegatives}`,
    `- Precision/recall/F1: ${summary.precision === null ? 'N/A' : summary.precision.toFixed(4)}/${summary.recall === null ? 'N/A' : summary.recall.toFixed(4)}/${summary.f1 === null ? 'N/A' : summary.f1.toFixed(4)}`,
    `- Started: ${String(metadata.startedAt ?? 'unknown')}`,
    `- Audit state: ${complete ? 'COMPLETE' : 'IN PROGRESS'}`,
    '',
  ].join('\n'), 'utf8');
  const mismatches = cases.filter((item) =>
    item.auditStatus === 'MISSED_DETECTION' || item.auditStatus === 'PERSISTENCE_FAILURE'
    || item.auditStatus === 'FALSE_POSITIVE' || item.healthScoreMatch === false
    || item.independentRiskScores.some((score) => score.matches === false));
  await writeFile(new URL('mismatches.md', output), [
    '# Audit mismatches',
    '',
    ...(mismatches.length
      ? mismatches.map((item) => `- **${item.caseId} — ${item.auditStatus}:** ${String(item.unverifiedReason ?? item.error ?? 'Observed behavior differs from the expected label or persisted score.')}`)
      : ['No verified score mismatches or detection mismatches were recorded. Unsupported, partial, and unverified cases remain explicit in `results.json`.']),
    '',
  ].join('\n'), 'utf8');
  await writeFile(new URL('final-report.md', output), [
    '# Post-fix audit report',
    '',
    `This audit attempted ${summary.attemptedRuns}/${summary.manifestCaseCount} cases from the unchanged fixture manifest.`,
    '',
    `- Jobs: ${summary.completedJobRuns} completed; ${summary.failedOrDeadLetterRuns} failed/dead-letter.`,
    `- Analysis: ${summary.completedAnalysisRuns} COMPLETED; ${summary.partialAnalysisRuns} PARTIAL.`,
    `- Classification: ${summary.detectedCases} detected; ${summary.correctlySafeCases} correctly safe; ${summary.unsupportedOrPartialCases} unsupported/partial; ${summary.missedDetections} missed; ${summary.persistenceFailures} persistence failures; ${summary.unverifiedCases} unverified.`,
    `- Strict-label confusion counts: TP=${summary.truePositives}, FP=${summary.falsePositives}, TN=${summary.trueNegatives}, FN=${summary.falseNegatives}; ${summary.excludedIncompleteGroundTruthCases} labeled cases excluded for incomplete analysis.`,
    `- Strict-label precision/recall/F1: ${summary.precision === null ? 'N/A' : summary.precision.toFixed(4)}/${summary.recall === null ? 'N/A' : summary.recall.toFixed(4)}/${summary.f1 === null ? 'N/A' : summary.f1.toFixed(4)}.`,
    `- Health arithmetic/API: ${summary.healthScoreMatches}/${summary.healthScoreComparisons} independent matches; ${summary.healthApiMatches}/${summary.healthApiComparisons} API matches.`,
    `- Risk arithmetic/API: ${summary.riskScoreMatches}/${summary.riskScoreComparisons} independent matches; ${summary.riskApiMatches}/${summary.riskApiComparisons} API matches. Missing assessments were not treated as zero.`,
    '',
    'Only exact `VULNERABLE_SQLI` and `SAFE_SQL` labels contribute to confusion counts or precision/recall/F1. Ambiguous, unsupported, and deferred categories remain listed per case but are not treated as expected positives. A no-finding PARTIAL analysis is excluded from classification metrics.',
    '',
  ].join('\n'), 'utf8');
  await writeFile(new URL('formula-reference.md', output), [
    '# Formula reference',
    '',
    'Score calculations use the immutable `profile_snapshot`, persisted assessment inputs, and persisted health-dimension `inputMetrics` from each real run. No formulas or fixture labels were modified.',
    '',
    '## Risk Score',
    '',
    '`clamp(severityBase[severity] + sum(adjustments[dimension][persisted_input]), 0, 100)`',
    '',
    'The script recomputes each persisted Risk Assessment and separately compares the authenticated finding API values. An absent assessment is not scored as zero.',
    '',
    '## Health Score',
    '',
    'For each scored dimension, the persisted severity penalty is applied to persisted technical-risk inputs and rounded/clamped to 0–100. Overall Health Score is the rounded weighted mean over dimensions with persisted scores only:',
    '',
    '`round(sum(dimension_score * configured_weight) / sum(configured_weight for scored dimensions))`',
    '',
    'A `PARTIAL` snapshot or run remains partial even when its available-dimension arithmetic matches. Health API values are compared to the persisted snapshot for the same run.',
    '',
  ].join('\n'), 'utf8');
}

async function finalizeSavedArtifacts(): Promise<void> {
  const output = new URL('../../../bugzero-50-independent-results/results.json', import.meta.url);
  const saved = JSON.parse(await readFile(output, 'utf8')) as {
    summary: Record<string, unknown>;
    cases: AuditCase[];
  };
  assert.equal(saved.cases.length, saved.summary.manifestCaseCount, 'Finalize requires a complete manifest-sized audit');
  for (const item of saved.cases) updateClassification(item);
  await persistArtifacts(saved.cases, {
    startedAt: saved.summary.startedAt,
    tenantId: saved.summary.tenantId,
    manifestCaseCount: saved.summary.manifestCaseCount ?? saved.cases.length,
  });
}

async function main(): Promise<void> {
  assert.equal(process.env.BUGZERO_LIVE_INTEGRATION, '1', 'Set BUGZERO_LIVE_INTEGRATION=1 to run this live audit');
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL must target the live audit database');
  const manifest = JSON.parse(await readFile(new URL('../../../bugzero-50-file-audit-fixture/labels.json', import.meta.url), 'utf8')) as {
    case_count: number;
    cases: FixtureCase[];
  };
  assert.equal(manifest.cases.length, manifest.case_count);
  const startedAt = new Date().toISOString();
  const organizationId = crypto.randomUUID();
  const pool = getDatabasePool();
  const users = new UserRepository(pool);
  const members = new MemberRepository(pool);
  const repositories = new RepositoryRepository(pool);
  const analysis = new AnalysisRepository(pool);
  const findingsRepository = new FindingRepository(pool);
  const evidenceRepository = new EvidenceRepository(pool);
  const risksRepository = new RiskAssessmentRepository(pool);
  const healthRepository = new HealthRepository(pool);
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const authenticator = createSignedTokenAuthenticator({
    publicKey,
    issuer: 'bugzero-score-audit',
    audience: 'bugzero-api',
  });
  const processor = new AnalysisJobProcessor();
  const worker = createAnalysisQueueWorker(
    (payload, attempt) => processor.process(payload, attempt),
  );
  const app = createApiServer({
    authenticate: authenticator,
  });
  const cases: AuditCase[] = [];
  const metadata = {
    startedAt,
    tenantId: organizationId,
    manifestCaseCount: manifest.cases.length,
  };
  try {
    void worker.run();
    await withOrganizationContext(organizationId, () =>
      pool.query('INSERT INTO organizations (id, name, slug) VALUES ($1, $2, $3)', [
        organizationId,
        'BugZero Independent Fixture Audit',
        `score-audit-${organizationId.slice(0, 8)}`,
      ]));
    const user = await users.create({
      email: `score-audit-${organizationId}@bugzero.invalid`,
      display_name: 'BugZero Independent Fixture Audit',
    });
    const token = signedToken(privateKey, user.id, organizationId);
    await withOrganizationContext(organizationId, () =>
      members.create({ organizationId, userId: user.id, role: 'OWNER' }));

    for (let index = 0; index < manifest.cases.length; index += 1) {
      const expected = manifest.cases[index]!;
      const caseId = expected.name.replace(/\.[^.]+$/, '');
      const partial: AuditCase = {
        caseId,
        expected,
        runStatus: null,
        jobStatus: null,
        findings: [],
        evidenceRecords: [],
        persistedRiskAssessments: [],
        independentRiskScores: [],
        riskApiMatches: [],
        riskApiValues: [],
        error: null,
        auditStatus: 'UNVERIFIED',
      };
      cases.push(partial);
      try {
        const source = await readFile(new URL(`../../../bugzero-50-file-audit-fixture/cases/${expected.name}`, import.meta.url), 'utf8');
        const sourceBytes = Buffer.from(source, 'utf8');
        const contentSha256 = createHash('sha256').update(sourceBytes).digest('hex');
        const commitSha = contentSha256.slice(0, 40);
        const registered = await withOrganizationContext(organizationId, () =>
          repositories.createWithCommitAndFiles({
            organizationId,
            provider: 'LOCAL',
            externalId: `${caseId}-${organizationId}`,
            fullName: `bugzero-audit/${caseId}`,
            defaultBranch: 'main',
            cloneUrl: `local://bugzero-audit/${caseId}`,
            commitSha,
            committedAt: new Date().toISOString(),
            indexedAt: new Date().toISOString(),
            files: [{
              path: expected.name,
              contentSha256,
              sizeBytes: sourceBytes.length,
              language: expected.language,
              sourceContent: source,
            }],
          }));
        partial.repositoryId = registered.repository.id;
        partial.commitId = registered.commit.id;

        const acceptedResponse = await app.inject({
          method: 'POST',
          url: '/analysis',
          headers: { authorization: `Bearer ${token}` },
          payload: {
            repositoryId: registered.repository.id,
            commitSha,
            profileId: 'default',
            scope: 'COMMIT',
          },
        });
        assert.equal(acceptedResponse.statusCode, 202, acceptedResponse.body);
        const accepted = acceptedResponse.json() as { analysisRunId: string; jobId: string };
        partial.analysisRunId = accepted.analysisRunId;
        partial.jobId = accepted.jobId;
        const deadline = Date.now() + 300_000;
        let status: Record<string, any> = {};
        while (Date.now() < deadline) {
          const response = await app.inject({
            method: 'GET',
            url: `/analysis/${accepted.analysisRunId}`,
            headers: { authorization: `Bearer ${token}` },
          });
          assert.equal(response.statusCode, 200, response.body);
          status = response.json() as Record<string, any>;
          partial.runStatus = typeof status.status === 'string' ? status.status : null;
          partial.jobStatus = typeof status.job?.status === 'string' ? status.job.status : null;
          if (['COMPLETED', 'FAILED', 'DEAD_LETTER', 'CANCELLED'].includes(partial.jobStatus ?? '')) break;
          await new Promise((resolve) => setTimeout(resolve, 200));
        }
        partial.apiRunStatus = partial.runStatus;
        partial.apiJobStatus = partial.jobStatus;

        const persistedRun = await withOrganizationContext(organizationId, () =>
          analysis.getRun(organizationId, accepted.analysisRunId));
        partial.runStatus = persistedRun?.status ?? partial.runStatus;
        const pipeline = record(record(persistedRun?.coverage).pipeline);
        partial.parserDiagnostics = pipeline.parseDiagnostics ?? [];
        partial.analyzerStatuses = pipeline.analyzers ?? [];
        partial.analyzerCoverage = {
          status: pipeline.status ?? null,
          scope: pipeline.scope ?? null,
          intelligenceStatus: pipeline.intelligenceStatus ?? null,
        };
        partial.filesDiscovered = pipeline.sourceFiles ?? null;
        partial.filesParsed = pipeline.parsedFiles ?? null;
        partial.irEntityCount = pipeline.irEntityCount ?? null;
        partial.irRelationshipCount = pipeline.irRelationshipCount ?? null;

        const found = await withOrganizationContext(organizationId, () =>
          findingsRepository.getByRepository(organizationId, registered.repository.id));
        const occurrences = (await Promise.all(found.map((item) =>
          withOrganizationContext(organizationId, () =>
            findingsRepository.getOccurrencesForFinding(organizationId, item.id)))))
          .flat()
          .filter((item) => item.analysis_run_id === accepted.analysisRunId);
        partial.findings = occurrences.map((occurrence) => ({
          findingId: occurrence.finding_id,
          ruleId: occurrence.rule_id,
          severity: occurrence.severity,
          confidence: occurrence.confidence,
          filePath: occurrence.file_path,
          startLine: occurrence.start_line,
          technicalRisk: occurrence.technical_risk,
        }));
        const persistedEvidence = (await Promise.all(found.map((item) =>
          withOrganizationContext(organizationId, () =>
            evidenceRepository.getEvidenceForFinding(organizationId, item.id)))))
          .flat()
          .filter((item) => item.analysis_run_id === accepted.analysisRunId);
        partial.evidenceRecords = persistedEvidence.map((item) => ({
          id: item.id,
          findingId: item.finding_id,
          occurrenceId: item.finding_occurrence_id,
          authority: item.authority,
          sufficiency: item.sufficiency,
          completeness: item.completeness,
        }));
        const persistedRisks = (await Promise.all(found.map((item) =>
          withOrganizationContext(organizationId, () => risksRepository.getForFinding(organizationId, item.id)))))
          .flat()
          .filter((item) => item.analysis_run_id === accepted.analysisRunId);
        partial.persistedRiskAssessments = persistedRisks.map((item) => ({ ...item }));
        partial.independentRiskScores = persistedRisks.map((item) => {
          const independent = scoreRisk(item);
          return {
            riskAssessmentId: item.id,
            persisted: item.technical_risk,
            independent,
            matches: independent === item.technical_risk,
          };
        });

        const health = await withOrganizationContext(organizationId, () =>
          healthRepository.getForRun(organizationId, registered.repository.id, accepted.analysisRunId));
        partial.healthSnapshotId = health?.id ?? null;
        partial.persistedHealthScore = health?.overall_score ?? null;
        partial.healthDimensions = health?.dimensions ?? null;
        partial.healthRawInputs = health ? {
          dimensions: health.dimensions,
          profile: health.profile_snapshot,
          calculation: health.calculation,
        } : null;
        const independentHealth = health ? scoreHealth(health) : { score: null, dimensions: {} };
        partial.independentHealthScore = independentHealth.score;
        partial.independentHealthDimensions = independentHealth.dimensions;
        partial.healthScoreMatch = health
          ? independentHealth.score === health.overall_score
          : null;

        const healthApiResponse = await app.inject({
          method: 'GET',
          url: `/repositories/${registered.repository.id}/health`,
          headers: { authorization: `Bearer ${token}` },
        });
        assert.equal(healthApiResponse.statusCode, 200, healthApiResponse.body);
        const apiSnapshots = (healthApiResponse.json() as { history: Array<Record<string, any>> }).history;
        const apiHealth = apiSnapshots.find((entry) => entry.snapshot?.analysis_run_id === accepted.analysisRunId);
        partial.healthApiValues = apiHealth ?? null;
        partial.healthApiScore = typeof apiHealth?.snapshot?.overall_score === 'number'
          ? apiHealth.snapshot.overall_score
          : null;
        partial.healthApiScoreMatch = health
          ? partial.healthApiScore === health.overall_score
          : null;

        const details = await Promise.all(found.map(async (item) => {
          const response = await app.inject({
            method: 'GET',
            url: `/findings/${item.id}`,
            headers: { authorization: `Bearer ${token}` },
          });
          if (response.statusCode !== 200) return { statusCode: response.statusCode, risks: [] };
          return response.json() as { risks?: Array<Record<string, unknown>> };
        }));
        partial.riskApiValues = details.flatMap((detail) => detail.risks ?? [])
          .filter((item) => item.analysis_run_id === accepted.analysisRunId)
          .flatMap((item) => typeof item.id === 'string' && Number.isFinite(Number(item.technical_risk))
            ? [{ id: item.id, technical_risk: Number(item.technical_risk) }]
            : []);
        partial.riskApiMatches = partial.persistedRiskAssessments.map((assessment) => {
          const apiValue = partial.riskApiValues.find((item: Record<string, any>) => item.id === assessment.id);
          return {
            riskAssessmentId: assessment.id,
            persisted: assessment.technical_risk,
            api: apiValue?.technical_risk ?? null,
            independent: scoreRisk(assessment),
            matches: apiValue?.technical_risk === assessment.technical_risk,
          };
        });
        updateClassification(partial);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown audit harness error';
        partial.error = [
          process.env.DATABASE_URL,
          process.env.DATABASE_URL_UNPOOLED,
          process.env.DATABASE_QUEUE_URL,
        ]
          .filter((secret): secret is string => Boolean(secret))
          .reduce((safe, secret) => safe.replaceAll(secret, '[REDACTED]'), message);
        partial.auditStatus = 'UNVERIFIED';
      }
      await persistArtifacts(cases, metadata);
      console.info(JSON.stringify({
        caseId,
        runStatus: partial.runStatus,
        jobStatus: partial.jobStatus,
        auditStatus: partial.auditStatus,
        healthScoreMatch: partial.healthScoreMatch ?? null,
        riskComparisons: partial.independentRiskScores.length,
      }));
    }
  } finally {
    await app.close();
    await worker.close();
  }
  await persistArtifacts(cases, metadata);
}

if (process.argv.includes('--finalize')) await finalizeSavedArtifacts();
else await main();
