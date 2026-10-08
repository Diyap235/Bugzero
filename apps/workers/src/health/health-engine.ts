import { z } from 'zod';

import {
  HealthBand as HealthBandSchema,
  HealthCoverage as HealthCoverageSchema,
  HealthStatus as HealthStatusSchema,
  type HealthProfile,
} from '@bugzero/contracts';

type HealthBand = z.infer<typeof HealthBandSchema>;
type HealthCoverage = z.infer<typeof HealthCoverageSchema>;
type HealthStatus = z.infer<typeof HealthStatusSchema>;

export type HealthFindingCategory = 'SECURITY' | 'QUALITY' | 'MAINTAINABILITY';
export type HealthAnalyzerStatus = 'COMPLETED' | 'PARTIAL' | 'FAILED' | 'UNKNOWN';
export type HealthSeverity = 'INFO' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface HealthFindingSignal {
  findingId: string;
  occurrenceId: string;
  ruleId: string;
  category: HealthFindingCategory;
  severity: HealthSeverity;
  confidence: 'LOW' | 'MEDIUM' | 'HIGH';
  technicalRisk: number | null;
  riskBand: 'INFO' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' | null;
  evidenceAuthority: 'AUTHORITATIVE' | 'INVESTIGATIVE' | 'UNKNOWN';
  evidenceCompleteness: 'COMPLETE' | 'PARTIAL' | 'INCOMPLETE';
}

export interface RepositoryHealthInput {
  organizationId: string;
  repositoryId: string;
  commitId: string;
  analysisRunId: string;
  findings: HealthFindingSignal[];
  analyzerStatuses: {
    security: HealthAnalyzerStatus;
    quality: HealthAnalyzerStatus;
    maintainability: HealthAnalyzerStatus;
  };
  upstreamComplete: boolean;
  sourceFileCount: number;
  parsedFileCount: number;
}

export interface HealthDimensionResult {
  score: number | null;
  status: HealthStatus;
  coverage: HealthCoverage;
  confidence: number | null;
  inputMetrics: Record<string, unknown>;
  explanation: string;
}

export interface RepositoryHealthAssessment {
  overallScore: number | null;
  overallStatus: HealthStatus;
  coverage: HealthCoverage;
  dimensions: {
    security: HealthDimensionResult;
    quality: HealthDimensionResult;
    dependencies: HealthDimensionResult;
    reliability: HealthDimensionResult;
    maintainability: HealthDimensionResult;
  };
  calculation: Record<string, unknown>;
  explanation: string;
  profile: HealthProfile;
}

export const defaultHealthProfile: HealthProfile = {
  id: 'default-v1',
  version: 1,
  modelVersion: 'bugzero-deterministic-health-v1',
  dimensionWeights: { security: 55, quality: 25, maintainability: 20 },
  severityPenalty: {
    security: { INFO: 1, LOW: 5, MEDIUM: 10, HIGH: 20, CRITICAL: 35 },
    quality: { INFO: 1, LOW: 3, MEDIUM: 7, HIGH: 12, CRITICAL: 20 },
    maintainability: { INFO: 1, LOW: 4, MEDIUM: 8, HIGH: 15, CRITICAL: 25 },
  },
  riskScale: 100,
  bands: [
    { status: 'EXCELLENT', minimum: 90, maximum: 100 },
    { status: 'GOOD', minimum: 75, maximum: 89 },
    { status: 'FAIR', minimum: 60, maximum: 74 },
    { status: 'POOR', minimum: 40, maximum: 59 },
    { status: 'CRITICAL', minimum: 0, maximum: 39 },
  ],
};

function assertProfile(profile: HealthProfile): void {
  if (!profile.id.trim() || !Number.isSafeInteger(profile.version) || profile.version < 1
    || !profile.modelVersion.trim() || !Number.isFinite(profile.riskScale) || profile.riskScale <= 0) {
    throw new Error('Invalid health profile identity or risk scale');
  }
  const weights = Object.values(profile.dimensionWeights);
  if (weights.some((weight) => !Number.isFinite(weight) || weight < 0)
    || weights.reduce((sum, weight) => sum + weight, 0) !== 100) {
    throw new Error('Health profile dimension weights must be nonnegative and sum to 100');
  }
  for (const dimension of ['security', 'quality', 'maintainability'] as const) {
    for (const severity of ['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const) {
      const penalty = profile.severityPenalty[dimension][severity];
      if (typeof penalty !== 'number' || !Number.isFinite(penalty) || penalty < 0) {
        throw new Error(`Invalid ${dimension} penalty for ${severity}`);
      }
    }
  }
  const bands = [...profile.bands].sort((left, right) => left.minimum - right.minimum);
  if (bands.length === 0 || bands[0]?.minimum !== 0 || bands[bands.length - 1]?.maximum !== 100) {
    throw new Error('Health profile bands must cover scores from 0 through 100');
  }
  for (let index = 0; index < bands.length; index += 1) {
    const band = bands[index];
    if (!band || !Number.isSafeInteger(band.minimum) || !Number.isSafeInteger(band.maximum)
      || band.minimum < 0 || band.maximum > 100 || band.minimum > band.maximum) {
      throw new Error('Health profile contains an invalid score band');
    }
    if (index > 0 && band.minimum !== (bands[index - 1]?.maximum ?? -1) + 1) {
      throw new Error('Health profile bands must be contiguous and non-overlapping');
    }
  }
}

function healthBand(score: number, profile: HealthProfile): HealthBand {
  const band = profile.bands.find((candidate) => score >= candidate.minimum && score <= candidate.maximum);
  if (!band) throw new Error(`Health profile has no band for score ${score}`);
  return band.status;
}

function analyzerCoverage(status: HealthAnalyzerStatus): HealthCoverage {
  if (status === 'COMPLETED') return 'COMPLETE';
  if (status === 'PARTIAL' || status === 'FAILED') return 'PARTIAL';
  return 'UNKNOWN';
}

function unavailableDimension(explanation: string, coverage: HealthCoverage = 'UNKNOWN'): HealthDimensionResult {
  return {
    score: null,
    status: 'UNKNOWN',
    coverage,
    confidence: null,
    inputMetrics: {},
    explanation,
  };
}

function assessDimension(
  category: HealthFindingCategory,
  status: HealthAnalyzerStatus,
  findings: HealthFindingSignal[],
  sourceFileCount: number,
  parsedFileCount: number,
  profile: HealthProfile,
): HealthDimensionResult {
  const coverage = analyzerCoverage(status);
  if (status === 'UNKNOWN') {
    return unavailableDimension(`${categoryLabel(category)} analysis was not run.`);
  }

  const matchingFindings = findings.filter((finding) =>
    finding.category === category || (category === 'QUALITY' && finding.category === 'MAINTAINABILITY'));
  if (status !== 'COMPLETED' && matchingFindings.length === 0) {
    return unavailableDimension(
      `${categoryLabel(category)} score is unavailable because analysis did not complete and produced no findings.`,
      'PARTIAL',
    );
  }
  const severityCounts: Record<HealthSeverity, number> = { INFO: 0, LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 };
  const confidenceCounts: Record<'LOW' | 'MEDIUM' | 'HIGH', number> = { LOW: 0, MEDIUM: 0, HIGH: 0 };
  let penalty = 0;
  let riskTotal = 0;
  let highRiskFindings = 0;
  let missingRisk = false;
  let missingRiskCount = 0;
  for (const finding of matchingFindings) {
    severityCounts[finding.severity] += 1;
    confidenceCounts[finding.confidence] += 1;
    if (finding.technicalRisk === null || !Number.isFinite(finding.technicalRisk)
      || finding.technicalRisk < 0 || finding.technicalRisk > profile.riskScale) {
      missingRisk = true;
      missingRiskCount += 1;
      continue;
    }
    const penaltyDimension = category === 'MAINTAINABILITY'
      ? 'maintainability'
      : category.toLowerCase() as 'security' | 'quality';
    const severityPenalty = profile.severityPenalty[penaltyDimension][finding.severity];
    if (severityPenalty === undefined) throw new Error(`Health profile has no penalty for ${category} ${finding.severity}`);
    penalty += severityPenalty * finding.technicalRisk / profile.riskScale;
    riskTotal += finding.technicalRisk;
    if (finding.riskBand === 'HIGH' || finding.riskBand === 'CRITICAL') highRiskFindings += 1;
  }

  const effectiveCoverage: HealthCoverage = missingRisk ? 'PARTIAL' : coverage;
  const score = matchingFindings.length > 0 && missingRisk
    ? null
    : Math.max(0, Math.min(100, Math.round(100 - penalty)));
  const statusResult = score === null ? 'PARTIAL' : healthBand(score, profile);
  const completeEvidenceCount = matchingFindings.filter((finding) =>
    finding.evidenceAuthority === 'AUTHORITATIVE' && finding.evidenceCompleteness === 'COMPLETE').length;
  const confidence = matchingFindings.length === 0
    ? null
    : Math.round(100 * completeEvidenceCount / matchingFindings.length);
  const explanation = missingRisk
    ? `${categoryLabel(category)} score is unavailable because one or more findings lack a persisted risk assessment.`
    : matchingFindings.length === 0
      ? `No ${categoryLabel(category).toLowerCase()} findings were detected by the completed analyzer.`
      : `${matchingFindings.length} ${categoryLabel(category).toLowerCase()} finding(s) reduced the score by ${Math.round(penalty)} points using severity penalties scaled by persisted technical risk.`;

  return {
    score,
    status: statusResult,
    coverage: effectiveCoverage,
    confidence,
    inputMetrics: {
      findingCount: matchingFindings.length,
      severityCounts,
      confidenceCounts,
      highRiskFindings,
      totalTechnicalRisk: Math.round(riskTotal * 100) / 100,
      codeLinesOfCode: null,
      findingsPer1000Lines: null,
      sourceFileCount,
      parsedFileCount,
      missingRiskAssessmentCount: missingRiskCount,
    },
    explanation,
  };
}

function categoryLabel(category: HealthFindingCategory): string {
  switch (category) {
    case 'SECURITY': return 'Security';
    case 'QUALITY': return 'Quality';
    case 'MAINTAINABILITY': return 'Maintainability';
  }
}

export class RepositoryHealthEngine {
  private readonly profile: HealthProfile;

  constructor(profile: HealthProfile = defaultHealthProfile) {
    this.profile = structuredClone(profile);
    assertProfile(this.profile);
  }

  assess(input: RepositoryHealthInput): RepositoryHealthAssessment {
    if (!Number.isSafeInteger(input.sourceFileCount) || input.sourceFileCount < 0
      || !Number.isSafeInteger(input.parsedFileCount) || input.parsedFileCount < 0) {
      throw new Error('Repository health file counts must be nonnegative integers');
    }
    const seenOccurrences = new Set<string>();
    const findings = input.findings.filter((finding) => {
      if (seenOccurrences.has(finding.occurrenceId)) return false;
      seenOccurrences.add(finding.occurrenceId);
      if (!Number.isFinite(finding.technicalRisk) && finding.technicalRisk !== null) {
        throw new Error(`Invalid risk score for finding ${finding.findingId}`);
      }
      return true;
    });
    const security = assessDimension('SECURITY', input.analyzerStatuses.security, findings, input.sourceFileCount, input.parsedFileCount, this.profile);
    const quality = assessDimension('QUALITY', input.analyzerStatuses.quality, findings, input.sourceFileCount, input.parsedFileCount, this.profile);
    const maintainability = assessDimension(
      'MAINTAINABILITY',
      input.analyzerStatuses.maintainability,
      findings,
      input.sourceFileCount,
      input.parsedFileCount,
      this.profile,
    );
    const dimensions = {
      security,
      quality,
      dependencies: unavailableDimension('Dependency vulnerability analysis is not implemented.'),
      reliability: unavailableDimension('No deterministic reliability signals are currently available.'),
      maintainability,
    };
    const available = (['security', 'quality', 'maintainability'] as const)
      .filter((name) => dimensions[name].score !== null)
      .map((name) => ({ name, score: dimensions[name].score as number, weight: this.profile.dimensionWeights[name] }))
      .filter((item) => item.weight > 0);
    const availableWeight = available.reduce((sum, dimension) => sum + dimension.weight, 0);
    const overallScore = availableWeight === 0
      ? null
      : Math.round(available.reduce((sum, dimension) => sum + dimension.score * dimension.weight, 0) / availableWeight);
    const allCoverage = Object.values(dimensions).map((dimension) => dimension.coverage);
    const coverage: HealthCoverage = overallScore === null && allCoverage.every((item) => item === 'UNKNOWN')
      ? 'UNKNOWN'
      : input.upstreamComplete && allCoverage.every((item) => item === 'COMPLETE')
        ? 'COMPLETE'
        : 'PARTIAL';
    const overallStatus: HealthStatus = overallScore === null ? 'UNKNOWN' : healthBand(overallScore, this.profile);
    const explanation = overallScore === null
      ? 'Overall repository health is UNKNOWN because no health dimensions have scored data.'
      : coverage === 'PARTIAL'
        ? `Overall repository health is ${overallStatus} based on scored dimensions; coverage is PARTIAL because one or more dimensions or upstream analysis stages are incomplete or unavailable.`
        : `Overall repository health is ${overallStatus}, calculated from the weighted available dimension scores.`;

    return {
      overallScore,
      overallStatus,
      coverage,
      dimensions,
      calculation: {
        formula: 'round(sum(scored dimension * configured dimension weight) / sum(weights for scored dimensions))',
        dimensionWeights: { ...this.profile.dimensionWeights },
        availableWeight,
        weightedDimensions: available,
        findingsCount: findings.length,
        analysisRunId: input.analysisRunId,
        upstreamComplete: input.upstreamComplete,
      },
      explanation,
      profile: structuredClone(this.profile),
    };
  }
}

export const repositoryHealthEngine = new RepositoryHealthEngine();
