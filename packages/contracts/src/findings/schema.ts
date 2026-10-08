import { z } from 'zod';
import { UUID, GitCommitSha, FindingLifecycle, ObservationState, FindingMatch, Severity, Confidence, ResolutionState } from '../common/enums.js';

export const FindingFingerprintSchema = z.object({
  ruleId: z.string().min(1),
  semanticTargetId: z.string().min(1),
  normalizedFingerprint: z.string().min(1),
  relationshipFingerprint: z.string().nullable(),
});

export const MachineAssessmentSchema = z.object({
  severity: Severity,
  confidence: Confidence,
  evidenceStrength: z.enum(['LOW', 'MEDIUM', 'HIGH', 'UNKNOWN']),
  exploitability: z.enum(['LOW', 'MEDIUM', 'HIGH', 'UNKNOWN']),
  reachability: z.enum(['LOW', 'MEDIUM', 'HIGH', 'UNKNOWN']),
  technicalRisk: z.number().min(0).max(100),
});

export const HumanDispositionSchema = z.object({
  businessPriority: z.enum(['LOW','MEDIUM','HIGH','URGENT']).nullable(),
  acceptedRisk: z.boolean(),
  exceptionId: UUID.nullable(),
  dispositionReason: z.string().nullable(),
});

export const FindingOccurrenceSchema = z.object({
  id: UUID,
  organizationId: UUID,
  findingId: UUID,
  repositoryId: UUID,
  commitId: UUID,
  analysisRunId: UUID,
  commitSha: GitCommitSha,
  filePath: z.string().nullable(),
  startLine: z.number().int().positive().nullable(),
  endLine: z.number().int().positive().nullable(),
  observation: ObservationState,
  assessment: MachineAssessmentSchema,
  fingerprint: FindingFingerprintSchema,
  resolution: ResolutionState,
  matchResult: FindingMatch,
  createdAt: z.string().datetime(),
});

export const FindingSchema = z.object({
  id: UUID,
  organizationId: UUID,
  repositoryId: UUID,
  ruleId: z.string().min(1),
  lifecycle: FindingLifecycle,
  currentOccurrenceId: UUID.nullable(),
  resolutionEvidenceId: UUID.nullable(),
  currentSeverity: Severity,
  currentConfidence: Confidence,
  currentRisk: z.number().min(0).max(100),
  lastSeenRevision: GitCommitSha.nullable(),
  humanDisposition: HumanDispositionSchema.nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const FindingMatchResultSchema = z.object({
  match: FindingMatch,
  existingFindingId: UUID.nullable(),
  reason: z.string().min(1),
  confidence: Confidence,
});

export type Finding = z.infer<typeof FindingSchema>;
export type FindingOccurrence = z.infer<typeof FindingOccurrenceSchema>;
export type FindingMatchResult = z.infer<typeof FindingMatchResultSchema>;
