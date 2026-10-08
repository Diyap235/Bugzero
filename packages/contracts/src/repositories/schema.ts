import { z } from 'zod';
import { UUID, Sha256, GitCommitSha, RepositoryProvider } from '../common/enums.js';

export const RepositorySchema = z.object({
  id: UUID,
  organizationId: UUID,
  provider: RepositoryProvider,
  externalId: z.string().min(1),
  fullName: z.string().min(1),
  defaultBranch: z.string().min(1),
  cloneUrl: z.string().url(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const RepositoryRevisionSchema = z.object({
  id: UUID,
  organizationId: UUID,
  repositoryId: UUID,
  commitSha: GitCommitSha,
  parentCommitSha: GitCommitSha.nullable(),
  createdAt: z.string().datetime(),
  indexedAt: z.string().datetime().nullable(),
});

export const OnboardGitHubRepositoryRequestSchema = z.object({
  fullName: z.string()
    .max(140)
    .regex(/^[A-Za-z0-9_.-]{1,39}\/[A-Za-z0-9_.-]{1,100}$/, 'Expected a GitHub owner/repository name'),
}).strict();

export const RepositoryFileSchema = z.object({
  id: UUID,
  organizationId: UUID,
  repositoryId: UUID,
  commitId: UUID,
  path: z.string().min(1),
  contentSha256: Sha256,
  sizeBytes: z.number().int().nonnegative(),
  language: z.string().nullable(),
});

export const AnalysisProfileSchema = z.object({
  id: z.string().min(1),
  organizationId: UUID,
  version: z.string().min(1),
  analyzers: z.array(z.string().min(1)).min(1),
  maxDepth: z.number().int().positive().nullable(),
});

export type Repository = z.infer<typeof RepositorySchema>;
export type RepositoryRevision = z.infer<typeof RepositoryRevisionSchema>;
export type RepositoryFile = z.infer<typeof RepositoryFileSchema>;
export type AnalysisProfile = z.infer<typeof AnalysisProfileSchema>;
