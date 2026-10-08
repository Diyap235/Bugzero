import { z } from 'zod';
import { UUID, Sha256, AnalysisScope } from '../common/enums.js';

export const CreateReviewRequestSchema = z.object({
  repositoryId: UUID,
  baseCommitSha: Sha256,
  headCommitSha: Sha256,
  scope: AnalysisScope.default('PR'),
  profileId: z.string().default('default'),
});

export const ReviewResponseSchema = z.object({
  reviewId: UUID,
  analysisRunId: UUID,
  status: z.enum(['QUEUED','RUNNING','COMPLETED','FAILED']),
});
