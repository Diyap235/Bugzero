import type {
  EvidenceAuthority,
  EvidenceCompleteness,
  EvidenceSufficiency,
  FindingConfidence,
  FindingSeverity,
} from '@bugzero/database';

export type RiskDimension = 'LOW' | 'MEDIUM' | 'HIGH' | 'UNKNOWN';
export type RiskBand = 'INFO' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type RiskAuthority = EvidenceAuthority | 'UNKNOWN';

export interface RiskProfile {
  id: string;
  version: number;
  modelVersion: string;
  severityBase: Record<FindingSeverity, number>;
  adjustments: {
    confidence: Record<FindingConfidence, number>;
    evidenceStrength: Record<RiskDimension, number>;
    evidenceAuthority: Record<RiskAuthority, number>;
    evidenceSufficiency: Record<EvidenceSufficiency, number>;
    evidenceCompleteness: Record<EvidenceCompleteness, number>;
    reachability: Record<RiskDimension, number>;
    exploitability: Record<RiskDimension, number>;
  };
  bands: Array<{ band: RiskBand; minimum: number; maximum: number }>;
}

export interface RiskAssessmentInput {
  severity: FindingSeverity;
  confidence: FindingConfidence;
  evidenceStrength: RiskDimension;
  evidenceAuthority: RiskAuthority;
  evidenceSufficiency: EvidenceSufficiency;
  evidenceCompleteness: EvidenceCompleteness;
  reachability: RiskDimension;
  exploitability: RiskDimension;
}

interface ScoredFactor<TValue extends string> {
  value: TValue;
  adjustment: number;
}

export interface RiskAssessmentCalculation {
  severityBase: number;
  adjustments: Record<string, number>;
  rawScore: number;
  finalScore: number;
}

export interface CalculatedRiskAssessment {
  severity: FindingSeverity;
  confidence: FindingConfidence;
  evidenceStrength: RiskDimension;
  evidenceAuthority: RiskAuthority;
  evidenceSufficiency: EvidenceSufficiency;
  evidenceCompleteness: EvidenceCompleteness;
  reachability: RiskDimension;
  exploitability: RiskDimension;
  dependencyExposure: 'UNKNOWN';
  affectedModuleCount: null;
  technicalRisk: number;
  riskBand: RiskBand;
  factors: {
    severity: ScoredFactor<FindingSeverity>;
    confidence: ScoredFactor<FindingConfidence>;
    evidenceStrength: ScoredFactor<RiskDimension>;
    evidenceAuthority: ScoredFactor<RiskAuthority>;
    evidenceSufficiency: ScoredFactor<EvidenceSufficiency>;
    evidenceCompleteness: ScoredFactor<EvidenceCompleteness>;
    reachability: ScoredFactor<RiskDimension>;
    exploitability: ScoredFactor<RiskDimension>;
    dependencyExposure: { value: 'UNKNOWN'; adjustment: 0; available: false };
    affectedModuleCount: { value: null; adjustment: 0; available: false };
  };
  calculation: RiskAssessmentCalculation;
  profileId: string;
  profileVersion: number;
  modelVersion: string;
  profileSnapshot: RiskProfile;
  explanation: string;
}

export const defaultRiskProfile: RiskProfile = {
  id: 'default-v1',
  version: 1,
  modelVersion: 'bugzero-deterministic-risk-v1',
  severityBase: { INFO: 0, LOW: 20, MEDIUM: 40, HIGH: 60, CRITICAL: 80 },
  adjustments: {
    confidence: { LOW: -10, MEDIUM: 0, HIGH: 5 },
    evidenceStrength: { UNKNOWN: 0, LOW: -10, MEDIUM: 0, HIGH: 5 },
    evidenceAuthority: { AUTHORITATIVE: 0, INVESTIGATIVE: -5, UNKNOWN: 0 },
    evidenceSufficiency: { SUFFICIENT: 5, INSUFFICIENT: -5, UNKNOWN: 0 },
    evidenceCompleteness: { COMPLETE: 5, PARTIAL: -5, INCOMPLETE: -10 },
    reachability: { UNKNOWN: 0, LOW: -5, MEDIUM: 0, HIGH: 5 },
    exploitability: { UNKNOWN: 0, LOW: -5, MEDIUM: 0, HIGH: 5 },
  },
  bands: [
    { band: 'INFO', minimum: 0, maximum: 9 },
    { band: 'LOW', minimum: 10, maximum: 29 },
    { band: 'MEDIUM', minimum: 30, maximum: 54 },
    { band: 'HIGH', minimum: 55, maximum: 79 },
    { band: 'CRITICAL', minimum: 80, maximum: 100 },
  ],
};

function assertKnownValue(value: string, allowed: readonly string[], name: string): void {
  if (!allowed.includes(value)) throw new Error(`Invalid risk factor ${name}: ${value}`);
}

function validateProfile(profile: RiskProfile): void {
  if (!profile.id.trim() || !Number.isSafeInteger(profile.version) || profile.version <= 0 || !profile.modelVersion.trim()) {
    throw new Error('Invalid risk profile identity or version');
  }
  for (const severity of ['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const) {
    const score = profile.severityBase[severity];
    if (!Number.isSafeInteger(score) || score < 0 || score > 100) {
      throw new Error(`Invalid base score for ${severity}`);
    }
  }
  const requiredAdjustments: Array<[keyof RiskProfile['adjustments'], readonly string[]]> = [
    ['confidence', ['LOW', 'MEDIUM', 'HIGH']],
    ['evidenceStrength', ['LOW', 'MEDIUM', 'HIGH', 'UNKNOWN']],
    ['evidenceAuthority', ['AUTHORITATIVE', 'INVESTIGATIVE', 'UNKNOWN']],
    ['evidenceSufficiency', ['SUFFICIENT', 'INSUFFICIENT', 'UNKNOWN']],
    ['evidenceCompleteness', ['COMPLETE', 'PARTIAL', 'INCOMPLETE']],
    ['reachability', ['LOW', 'MEDIUM', 'HIGH', 'UNKNOWN']],
    ['exploitability', ['LOW', 'MEDIUM', 'HIGH', 'UNKNOWN']],
  ];
  for (const [dimension, values] of requiredAdjustments) {
    for (const value of values) {
      if (!Object.hasOwn(profile.adjustments[dimension], value)) {
        throw new Error(`Risk profile is missing ${dimension} adjustment for ${value}`);
      }
    }
  }
  for (const [severity, score] of Object.entries(profile.severityBase)) {
    if (!Number.isSafeInteger(score) || score < 0 || score > 100) throw new Error(`Invalid base score for ${severity}`);
  }
  for (const [dimension, values] of Object.entries(profile.adjustments)) {
    for (const [value, adjustment] of Object.entries(values)) {
      if (!Number.isSafeInteger(adjustment) || adjustment < -100 || adjustment > 100) {
        throw new Error(`Invalid ${dimension} adjustment for ${value}`);
      }
    }
  }
  if (profile.bands.length === 0) throw new Error('Risk profile must define score bands');
  const bands = [...profile.bands].sort((left, right) => left.minimum - right.minimum);
  if (bands[0]?.minimum !== 0 || bands[bands.length - 1]?.maximum !== 100) {
    throw new Error('Risk profile bands must cover scores from 0 through 100');
  }
  for (let index = 0; index < bands.length; index += 1) {
    const band = bands[index];
    if (!band || !Number.isSafeInteger(band.minimum) || !Number.isSafeInteger(band.maximum)
      || band.minimum < 0 || band.maximum > 100 || band.minimum > band.maximum) {
      throw new Error('Risk profile contains an invalid score band');
    }
    if (index > 0 && band.minimum !== (bands[index - 1]?.maximum ?? -1) + 1) {
      throw new Error('Risk profile bands must be contiguous and non-overlapping');
    }
  }
}

function factor<TValue extends string>(
  value: TValue,
  adjustments: Record<TValue, number>,
): ScoredFactor<TValue> {
  const adjustment = adjustments[value];
  if (!Number.isSafeInteger(adjustment)) throw new Error(`Risk profile has no valid adjustment for ${value}`);
  return { value, adjustment };
}

function explanationFor(
  base: number,
  adjustments: Record<string, number>,
  raw: number,
  score: number,
  band: RiskBand,
): string {
  const lines = [`Severity established a base score of ${base}.`];
  for (const [name, adjustment] of Object.entries(adjustments)) {
    lines.push(`${name} adjusted the score by ${adjustment >= 0 ? '+' : ''}${adjustment}.`);
  }
  lines.push(`The unbounded score was ${raw}; it was bounded to ${score}/100 in the ${band} band.`);
  lines.push('Dependency exposure and affected-module count are unavailable and were not scored.');
  return lines.join(' ');
}

export class DeterministicRiskEngine {
  private readonly profile: RiskProfile;

  constructor(profile: RiskProfile = defaultRiskProfile) {
    this.profile = structuredClone(profile);
    validateProfile(this.profile);
  }

  assess(input: RiskAssessmentInput): CalculatedRiskAssessment {
    assertKnownValue(input.severity, ['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'], 'severity');
    assertKnownValue(input.confidence, ['LOW', 'MEDIUM', 'HIGH'], 'confidence');
    assertKnownValue(input.evidenceStrength, ['LOW', 'MEDIUM', 'HIGH', 'UNKNOWN'], 'evidenceStrength');
    assertKnownValue(input.evidenceAuthority, ['AUTHORITATIVE', 'INVESTIGATIVE', 'UNKNOWN'], 'evidenceAuthority');
    assertKnownValue(input.evidenceSufficiency, ['SUFFICIENT', 'INSUFFICIENT', 'UNKNOWN'], 'evidenceSufficiency');
    assertKnownValue(input.evidenceCompleteness, ['COMPLETE', 'PARTIAL', 'INCOMPLETE'], 'evidenceCompleteness');
    assertKnownValue(input.reachability, ['LOW', 'MEDIUM', 'HIGH', 'UNKNOWN'], 'reachability');
    assertKnownValue(input.exploitability, ['LOW', 'MEDIUM', 'HIGH', 'UNKNOWN'], 'exploitability');

    const evidenceSufficiency = input.evidenceCompleteness === 'COMPLETE' && input.evidenceSufficiency === 'SUFFICIENT'
      ? 'SUFFICIENT'
      : input.evidenceSufficiency === 'SUFFICIENT'
        ? 'UNKNOWN'
        : input.evidenceSufficiency;
    const factors = {
      severity: { value: input.severity, adjustment: 0 },
      confidence: factor(input.confidence, this.profile.adjustments.confidence),
      evidenceStrength: factor(input.evidenceStrength, this.profile.adjustments.evidenceStrength),
      evidenceAuthority: factor(input.evidenceAuthority, this.profile.adjustments.evidenceAuthority),
      evidenceSufficiency: factor(evidenceSufficiency, this.profile.adjustments.evidenceSufficiency),
      evidenceCompleteness: factor(input.evidenceCompleteness, this.profile.adjustments.evidenceCompleteness),
      reachability: factor(input.reachability, this.profile.adjustments.reachability),
      exploitability: factor(input.exploitability, this.profile.adjustments.exploitability),
      dependencyExposure: { value: 'UNKNOWN' as const, adjustment: 0 as const, available: false as const },
      affectedModuleCount: { value: null, adjustment: 0 as const, available: false as const },
    };
    const severityBase = this.profile.severityBase[input.severity];
    if (!Number.isSafeInteger(severityBase) || severityBase < 0 || severityBase > 100) {
      throw new Error(`Risk profile has no valid base score for ${input.severity}`);
    }
    const adjustments = {
      confidence: factors.confidence.adjustment,
      evidenceStrength: factors.evidenceStrength.adjustment,
      evidenceAuthority: factors.evidenceAuthority.adjustment,
      evidenceSufficiency: factors.evidenceSufficiency.adjustment,
      evidenceCompleteness: factors.evidenceCompleteness.adjustment,
      reachability: factors.reachability.adjustment,
      exploitability: factors.exploitability.adjustment,
    };
    const rawScore = severityBase + Object.values(adjustments).reduce((total, value) => total + value, 0);
    const finalScore = Math.min(100, Math.max(0, rawScore));
    if (!Number.isFinite(finalScore) || finalScore < 0 || finalScore > 100) {
      throw new Error('Risk calculation produced an invalid score');
    }
    const band = this.profile.bands.find((candidate) =>
      finalScore >= candidate.minimum && finalScore <= candidate.maximum)?.band;
    if (!band) throw new Error(`Risk profile has no band for score ${finalScore}`);
    const calculation = { severityBase, adjustments, rawScore, finalScore };
    return {
      ...input,
      evidenceSufficiency,
      dependencyExposure: 'UNKNOWN',
      affectedModuleCount: null,
      technicalRisk: finalScore,
      riskBand: band,
      factors,
      calculation,
      profileId: this.profile.id,
      profileVersion: this.profile.version,
      modelVersion: this.profile.modelVersion,
      profileSnapshot: structuredClone(this.profile),
      explanation: explanationFor(severityBase, adjustments, rawScore, finalScore, band),
    };
  }
}

export const deterministicRiskEngine = new DeterministicRiskEngine();
