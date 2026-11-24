import { z } from 'zod';
import { UUID, GitCommitSha, AnalysisStatus, AnalysisStage, AnalysisScope, JobState, AnalyzerType, Confidence } from '../common/enums.js';

export const AnalysisRunSchema = z.object({
  id: UUID,
  organizationId: UUID,
  repositoryId: UUID,
  commitId: UUID,
  commitSha: GitCommitSha,
  profileId: z.string().min(1),
  profileVersion: z.string().min(1),
  scope: AnalysisScope,
  status: AnalysisStatus,
  createdAt: z.string().datetime(),
  startedAt: z.string().datetime().nullable(),
  completedAt: z.string().datetime().nullable(),
});

export const AnalysisCapabilitySchema = z.object({
  runId: UUID,
  organizationId: UUID,
  capability: AnalysisStage,
  status: AnalysisStatus,
  coveragePercent: z.number().min(0).max(100).nullable(),
  confidence: Confidence.nullable(),
  errorCode: z.string().nullable(),
  updatedAt: z.string().datetime(),
});

export const AnalysisJobSchema = z.object({
  id: UUID,
  organizationId: UUID,
  runId: UUID,
  stage: AnalysisStage,
  analyzer: z.string().min(1),
  analyzerType: AnalyzerType,
  scopeKey: z.string().min(1),
  status: JobState,
  attempt: z.number().int().min(0),
  idempotencyKey: z.string().min(1),
  createdAt: z.string().datetime(),
  startedAt: z.string().datetime().nullable(),
  finishedAt: z.string().datetime().nullable(),
});

export const CreateAnalysisRequestSchema = z.object({
  repositoryId: UUID,
  commitSha: GitCommitSha,
  profileId: z.string().default('default'),
  scope: AnalysisScope.default('COMMIT'),
  changedFiles: z.array(z.string()).default([]),
  changedEntityIds: z.array(UUID).default([]),
});

export const AnalysisQueuePayloadSchema = z.object({
  organizationId: UUID,
  jobId: UUID,
});

export const AcceptedAnalysisSchema = z.object({
  analysisRunId: UUID,
  jobId: UUID,
  status: JobState,
});

export const AnalysisRunStatusResponseSchema = z.object({
  analysisRunId: UUID,
  status: AnalysisStatus,
  job: AnalysisJobSchema.pick({
    id: true,
    status: true,
    stage: true,
    attempt: true,
    createdAt: true,
    startedAt: true,
    finishedAt: true,
  }).nullable(),
  progress: z.record(z.unknown()),
  failure: z.string().nullable(),
  startedAt: z.string().datetime().nullable(),
  completedAt: z.string().datetime().nullable(),
});

export type AnalysisRun = z.infer<typeof AnalysisRunSchema>;
export type AnalysisJob = z.infer<typeof AnalysisJobSchema>;
export type CreateAnalysisRequest = z.infer<typeof CreateAnalysisRequestSchema>;
export type AnalysisQueuePayload = z.infer<typeof AnalysisQueuePayloadSchema>;
export type AcceptedAnalysis = z.infer<typeof AcceptedAnalysisSchema>;
export type AnalysisRunStatusResponse = z.infer<typeof AnalysisRunStatusResponseSchema>;
