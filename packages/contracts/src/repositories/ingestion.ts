import { z } from 'zod';

import { UUID } from '../common/enums.js';

export const RepositoryFileSnapshotSchema = z.object({
  path: z.string().min(1),
  language: z.string().min(1),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/i, 'Expected SHA-256 hex'),
  sizeBytes: z.number().int().nonnegative(),
  lineCount: z.number().int().nonnegative(),
  isGenerated: z.boolean(),
});

export const RepositoryIngestionRequestSchema = z.object({
  organizationId: UUID,
  repositoryId: UUID,
  commitSha: z.string().min(1).optional(),
  branch: z.string().min(1).optional(),
  maxFileSizeBytes: z.number().int().positive().default(10 * 1024 * 1024),
  maxFiles: z.number().int().positive().default(2000),
  maxTotalBytes: z.number().int().positive().default(200 * 1024 * 1024),
});

export const RepositoryIngestionStatusSchema = z.enum(['SUCCESS', 'PARTIAL', 'FAILED', 'INCOMPLETE', 'REUSED']);

export const RepositoryIngestionResultSchema = z.object({
  repositoryId: UUID,
  commitId: UUID.nullable(),
  commitSha: z.string().min(1),
  filesDiscovered: z.number().int().nonnegative(),
  filesPersisted: z.number().int().nonnegative(),
  totalBytes: z.number().int().nonnegative(),
  languages: z.array(z.string().min(1)),
  skippedFiles: z.array(z.string()).default([]),
  generatedFiles: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative(),
  status: RepositoryIngestionStatusSchema,
});

export type RepositoryFileSnapshot = z.infer<typeof RepositoryFileSnapshotSchema>;
export type RepositoryIngestionRequest = z.infer<typeof RepositoryIngestionRequestSchema>;
export type RepositoryIngestionStatus = z.infer<typeof RepositoryIngestionStatusSchema>;
export type RepositoryIngestionResult = z.infer<typeof RepositoryIngestionResultSchema>;
