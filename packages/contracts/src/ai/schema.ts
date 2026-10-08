import { z } from 'zod';

export const AIInvestigationResultSchema = z.object({
  summary: z.string().trim().min(1).max(500),
  explanation: z.string().trim().min(1).max(2_000),
  attackPath: z.array(z.string().trim().min(1).max(300)).max(12),
  remediation: z.array(z.string().trim().min(1).max(300)).max(12),
  confidence: z.enum(['LOW', 'MEDIUM', 'HIGH']),
  reasoningStatus: z.enum(['SUPPORTED', 'INVESTIGATIVE', 'INSUFFICIENT_EVIDENCE']),
}).strict();

export const AIInvestigationStatusSchema = z.enum(['PENDING', 'COMPLETED', 'FAILED']);

export const AIInvestigationRecordSchema = z.object({
  id: z.string().uuid(),
  provider: z.literal('GROQ'),
  model: z.string().min(1),
  promptVersion: z.string().min(1),
  status: AIInvestigationStatusSchema,
  result: AIInvestigationResultSchema.nullable(),
  errorCode: z.enum([
    'MISSING_CONFIGURATION',
    'INVALID_CONFIGURATION',
    'TIMEOUT',
    'RATE_LIMITED',
    'PROVIDER_ERROR',
    'INVALID_RESPONSE',
    'CONTEXT_TOO_LARGE',
  ]).nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type AIInvestigationResult = z.infer<typeof AIInvestigationResultSchema>;
export type AIInvestigationRecord = z.infer<typeof AIInvestigationRecordSchema>;
