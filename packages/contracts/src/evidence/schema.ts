import { z } from 'zod';
import { UUID, GitCommitSha, EvidenceAuthority, EvidenceOrigin, EvidenceSufficiency, EvidenceCompleteness, ResolutionState, Confidence } from '../common/enums.js';

export const EvidenceNodeSchema = z.object({
  organizationId: UUID,
  evidenceId: UUID,
  id: z.string().min(1),
  type: z.enum(['REPOSITORY','FILE','MODULE','CLASS','FUNCTION','METHOD','PARAMETER','VARIABLE','DEPENDENCY','CALL','TRANSFORMATION','SANITIZER','SINK','SOURCE','EXTERNAL_BOUNDARY','DATABASE_OPERATION','FILE_OPERATION','PROCESS_OPERATION','UNKNOWN']),
  label: z.string().min(1),
  filePath: z.string().nullable(),
  line: z.number().int().positive().nullable(),
  endLine: z.number().int().positive().nullable(),
  startColumn: z.number().int().positive().nullable(),
  endColumn: z.number().int().positive().nullable(),
  sourceEntityId: z.string().nullable(),
  findingId: UUID.nullable(),
  authority: EvidenceAuthority,
  confidence: Confidence,
  provenance: z.enum(['CODE_IR','REPOSITORY_INTELLIGENCE','STATIC_ANALYZER','SECURITY_ANALYZER','DEPENDENCY_ANALYZER','AI','HUMAN']),
  metadata: z.record(z.unknown()),
});

export const EvidenceEdgeSchema = z.object({
  organizationId: UUID,
  evidenceId: UUID,
  id: z.string().min(1),
  from: z.string().min(1),
  to: z.string().min(1),
  relation: z.string().min(1),
  resolution: ResolutionState,
  confidence: z.enum(['LOW','MEDIUM','HIGH']),
});

export const EvidencePathSchema = z.object({
  id: z.string().min(1),
  nodeIds: z.array(z.string().min(1)).min(1),
  edgeIds: z.array(z.string().min(1)),
  completeness: EvidenceCompleteness,
  diagnostics: z.array(z.string()),
});

export const EvidenceSnapshotSchema = z.object({
  id: UUID,
  organizationId: UUID,
  findingOccurrenceId: UUID,
  identityFingerprint: z.string().min(1),
  analysisRunId: UUID,
  repositoryId: UUID,
  commitId: UUID,
  commitSha: GitCommitSha,
  authority: EvidenceAuthority,
  origin: EvidenceOrigin,
  sufficiency: EvidenceSufficiency,
  completeness: EvidenceCompleteness,
  complete: z.boolean(),
  diagnostics: z.array(z.string()),
  analyzerVersions: z.record(z.string()),
  nodes: z.array(EvidenceNodeSchema),
  edges: z.array(EvidenceEdgeSchema),
  paths: z.array(EvidencePathSchema),
  createdAt: z.string().datetime(),
});

export const EvidencePackageSchema = z.object({
  findingId: UUID,
  findingOccurrenceId: UUID,
  snapshot: EvidenceSnapshotSchema,
  nodes: z.array(EvidenceNodeSchema).max(500),
  edges: z.array(EvidenceEdgeSchema).max(1000),
  paths: z.array(EvidencePathSchema).max(100),
  codeEntities: z.array(z.record(z.unknown())).max(500),
  dependencies: z.array(z.record(z.unknown())).max(200),
  history: z.array(z.record(z.unknown())).max(100),
  diagnostics: z.array(z.string()),
});

export const AiExplanationSchema = z.object({
  id: UUID,
  organizationId: UUID,
  findingId: UUID,
  findingOccurrenceId: UUID,
  evidenceId: UUID.nullable(),
  provider: z.string().min(1),
  model: z.string().min(1),
  status: z.enum(['PENDING','COMPLETED','FAILED']),
  content: z.string().nullable(),
  createdAt: z.string().datetime(),
});

export const EvidenceSufficiencyRequestSchema = z.object({
  evidenceId: UUID,
  unresolvedRelationships: z.array(z.string()).default([]),
  materialToConclusion: z.boolean(),
});

export type EvidenceSnapshot = z.infer<typeof EvidenceSnapshotSchema>;
export type EvidenceNode = z.infer<typeof EvidenceNodeSchema>;
export type EvidenceEdge = z.infer<typeof EvidenceEdgeSchema>;
export type EvidencePath = z.infer<typeof EvidencePathSchema>;
export type EvidencePackage = z.infer<typeof EvidencePackageSchema>;
export type AiExplanation = z.infer<typeof AiExplanationSchema>;
