import { z } from 'zod';
import { UUID } from '../common/enums.js';

export const ReportSummarySchema = z.object({
  id: UUID,
  organizationId: UUID,
  repositoryId: UUID,
  analysisRunId: UUID,
  createdByUserId: UUID.nullable(),
  format: z.enum(['JSON', 'PDF', 'HTML']),
  metadata: z.record(z.string(), z.unknown()),
  createdAt: z.string().datetime(),
});

export const ReportListResponseSchema = z.object({
  reports: z.array(ReportSummarySchema),
});

export type ReportSummary = z.infer<typeof ReportSummarySchema>;
export type ReportListResponse = z.infer<typeof ReportListResponseSchema>;
