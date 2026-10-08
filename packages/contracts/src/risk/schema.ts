import { z } from 'zod';
import {
  UUID,
  GitCommitSha,
  Severity,
  Confidence,
  HealthBand,
  HealthCoverage,
  HealthDimension,
  HealthStatus,
} from '../common/enums.js';

export const RiskBand = z.enum(['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
export const RiskDimension = z.enum(['LOW', 'MEDIUM', 'HIGH', 'UNKNOWN']);
export const RiskEvidenceAuthority = z.enum(['AUTHORITATIVE', 'INVESTIGATIVE', 'UNKNOWN']);
export const RiskEvidenceSufficiency = z.enum(['SUFFICIENT', 'INSUFFICIENT', 'UNKNOWN']);
export const RiskEvidenceCompleteness = z.enum(['COMPLETE', 'PARTIAL', 'INCOMPLETE']);

export const RiskFactorsSchema = z.object({
  severity: z.object({ value: Severity, adjustment: z.number().int() }),
  confidence: z.object({ value: Confidence, adjustment: z.number().int() }),
  evidenceStrength: z.object({ value: RiskDimension, adjustment: z.number().int() }),
  evidenceAuthority: z.object({ value: RiskEvidenceAuthority, adjustment: z.number().int() }),
  evidenceSufficiency: z.object({ value: RiskEvidenceSufficiency, adjustment: z.number().int() }),
  evidenceCompleteness: z.object({ value: RiskEvidenceCompleteness, adjustment: z.number().int() }),
  reachability: z.object({ value: RiskDimension, adjustment: z.number().int() }),
  exploitability: z.object({ value: RiskDimension, adjustment: z.number().int() }),
  dependencyExposure: z.object({ value: z.literal('UNKNOWN'), adjustment: z.literal(0), available: z.boolean() }),
  affectedModuleCount: z.object({
    value: z.number().int().nonnegative().nullable(),
    adjustment: z.number().int(),
    available: z.boolean(),
  }),
});

export const RiskAssessmentSchema = z.object({
  id: UUID,
  organizationId: UUID,
  findingId: UUID,
  findingOccurrenceId: UUID,
  evidenceId: UUID,
  repositoryId: UUID,
  commitId: UUID,
  analysisRunId: UUID,
  severity: Severity,
  confidence: Confidence,
  evidenceStrength: RiskDimension,
  evidenceAuthority: RiskEvidenceAuthority,
  evidenceSufficiency: RiskEvidenceSufficiency,
  evidenceCompleteness: RiskEvidenceCompleteness,
  exploitability: RiskDimension,
  reachability: RiskDimension,
  dependencyExposure: z.literal('UNKNOWN'),
  affectedModuleCount: z.null(),
  technicalRisk: z.number().min(0).max(100),
  riskBand: RiskBand,
  factors: RiskFactorsSchema,
  calculation: z.object({
    severityBase: z.number().int().min(0).max(100),
    adjustments: z.record(z.string(), z.number().int()),
    rawScore: z.number().int(),
    finalScore: z.number().int().min(0).max(100),
  }),
  profileId: z.string().min(1),
  profileVersion: z.number().int().positive(),
  profileSnapshot: z.record(z.string(), z.unknown()),
  explanation: z.string().min(1),
  modelVersion: z.string().min(1),
  assessedAt: z.string().datetime(),
});

export const HealthDimensionSchema = z.object({
  score: z.number().min(0).max(100).nullable(),
  status: HealthStatus,
  coverage: HealthCoverage,
  confidence: z.number().min(0).max(100).nullable(),
  inputMetrics: z.record(z.string(), z.unknown()),
  explanation: z.string().min(1),
});

export const HealthDimensionsSchema = z.object({
  security: HealthDimensionSchema,
  quality: HealthDimensionSchema,
  dependencies: HealthDimensionSchema,
  reliability: HealthDimensionSchema,
  maintainability: HealthDimensionSchema,
});

export const HealthProfileSchema = z.object({
  id: z.string().min(1),
  version: z.number().int().positive(),
  modelVersion: z.string().min(1),
  dimensionWeights: z.object({
    security: z.number().nonnegative(),
    quality: z.number().nonnegative(),
    maintainability: z.number().nonnegative(),
  }),
  severityPenalty: z.object({
    security: z.record(Severity, z.number().nonnegative()),
    quality: z.record(Severity, z.number().nonnegative()),
    maintainability: z.record(Severity, z.number().nonnegative()),
  }),
  riskScale: z.number().positive(),
  bands: z.array(z.object({
    status: HealthBand,
    minimum: z.number().int().min(0).max(100),
    maximum: z.number().int().min(0).max(100),
  })).min(1),
});

export const LegacyHealthSnapshotSchema = z.object({
  id: UUID,
  organizationId: UUID,
  repositoryId: UUID,
  commitSha: GitCommitSha,
  securityScore: z.number().min(0).max(100),
  qualityScore: z.number().min(0).max(100),
  reliabilityScore: z.number().min(0).max(100),
  maintainabilityScore: z.number().min(0).max(100),
  dependencyScore: z.number().min(0).max(100),
  createdAt: z.string().datetime(),
});

export const HealthSnapshotSchema = z.union([z.object({
  id: UUID,
  organizationId: UUID,
  repositoryId: UUID,
  commitId: UUID,
  analysisRunId: UUID,
  profileId: z.string().min(1),
  profileVersion: z.number().int().positive(),
  overallScore: z.number().min(0).max(100).nullable(),
  overallStatus: HealthStatus,
  coverage: HealthCoverage,
  dimensions: HealthDimensionsSchema,
  securityScore: z.number().min(0).max(100).nullable(),
  qualityScore: z.number().min(0).max(100).nullable(),
  reliabilityScore: z.number().min(0).max(100).nullable(),
  maintainabilityScore: z.number().min(0).max(100).nullable(),
  dependencyScore: z.number().min(0).max(100).nullable(),
  calculation: z.record(z.string(), z.unknown()),
  explanation: z.string().min(1),
  createdAt: z.string().datetime(),
}), LegacyHealthSnapshotSchema]);

export type RiskAssessment = z.infer<typeof RiskAssessmentSchema>;
export type HealthSnapshot = z.infer<typeof HealthSnapshotSchema>;
export type HealthDimensionData = z.infer<typeof HealthDimensionSchema>;
export type HealthProfile = z.infer<typeof HealthProfileSchema>;
