import { z } from 'zod';
import { UUID, Severity, AnalysisStatus } from '../common/enums.js';

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

export const CreateReportRequestSchema = z.object({
  analysisRunId: UUID,
});

export const ReportFindingSchema = z.object({
  findingId: UUID,
  ruleId: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  severity: Severity,
  confidence: z.enum(['LOW', 'MEDIUM', 'HIGH']),
  lifecycle: z.string(),
  filePath: z.string().nullable(),
  startLine: z.number().int().positive().nullable(),
  endLine: z.number().int().positive().nullable(),
  evidenceAuthority: z.enum(['AUTHORITATIVE', 'INVESTIGATIVE', 'UNKNOWN']),
  evidenceStatus: z.enum(['COMPLETE', 'PARTIAL', 'INCOMPLETE', 'UNKNOWN']),
  evidence: z.array(z.string()),
  investigativeEstimate: z.object({
    summary: z.string(),
    explanation: z.string(),
    remediation: z.array(z.string()),
    confidence: z.enum(['LOW', 'MEDIUM', 'HIGH']),
    reasoningStatus: z.enum(['SUPPORTED', 'INVESTIGATIVE', 'INSUFFICIENT_EVIDENCE']),
  }).nullable(),
});

export const ReportDocumentSchema = z.object({
  id: UUID,
  repository: z.object({
    id: UUID,
    name: z.string(),
  }),
  analysis: z.object({
    runId: UUID,
    status: AnalysisStatus,
    scope: z.string(),
    commitSha: z.string().nullable(),
    createdAt: z.string().datetime(),
    completedAt: z.string().datetime().nullable(),
    coverage: z.record(z.string(), z.unknown()),
  }),
  executiveSummary: z.string(),
  findings: z.object({
    total: z.number().int().nonnegative(),
    bySeverity: z.record(Severity, z.number().int().nonnegative()),
    security: z.array(ReportFindingSchema),
    codeQuality: z.array(ReportFindingSchema),
  }),
  results: z.object({
    quality: z.object({ status: z.string(), score: z.number().nullable() }),
    maintainability: z.object({ status: z.string(), score: z.number().nullable() }),
    reliability: z.object({ status: z.string(), score: z.number().nullable() }),
    dependencies: z.object({ status: z.string(), score: z.number().nullable() }),
    coverage: z.object({ status: z.string(), details: z.record(z.string(), z.unknown()) }),
  }),
  recommendations: z.array(z.object({
    text: z.string(),
    basis: z.string(),
    authority: z.enum(['AUTHORITATIVE', 'INVESTIGATIVE']),
  })),
  evidencePolicy: z.object({
    authoritative: z.string(),
    investigative: z.string(),
  }),
});

export const ReportDocumentResponseSchema = z.object({
  report: ReportDocumentSchema,
});

export type ReportSummary = z.infer<typeof ReportSummarySchema>;
export type ReportListResponse = z.infer<typeof ReportListResponseSchema>;
export type CreateReportRequest = z.infer<typeof CreateReportRequestSchema>;
export type ReportFinding = z.infer<typeof ReportFindingSchema>;
export type ReportDocument = z.infer<typeof ReportDocumentSchema>;
