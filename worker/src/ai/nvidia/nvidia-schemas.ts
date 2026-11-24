import { z } from 'zod';

const DimensionSchema = z.object({
  score: z.number().int().min(0).max(100).nullable(),
  confidence: z.enum(['LOW', 'MEDIUM', 'HIGH']).nullable(),
  explanation: z.string().trim().min(1).max(1_000),
  evidence: z.array(z.object({
    filePath: z.string().trim().min(1).max(240),
    line: z.number().int().positive(),
  }).strict()).max(12),
}).strict();

const FindingSchema = z.object({
  dimension: z.enum(['SECURITY', 'QUALITY', 'MAINTAINABILITY', 'RELIABILITY', 'DEPENDENCIES']),
  title: z.string().trim().min(1).max(180),
  severity: z.enum(['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
  filePath: z.string().trim().min(1).max(240),
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
  explanation: z.string().trim().min(1).max(1_000),
  remediation: z.string().trim().min(1).max(1_000),
}).strict();

export const AIRepositoryReviewOutcomeSchema = z.object({
  dimensions: z.object({
    SECURITY: DimensionSchema,
    QUALITY: DimensionSchema,
    MAINTAINABILITY: DimensionSchema,
    RELIABILITY: DimensionSchema,
    DEPENDENCIES: DimensionSchema,
  }).strict(),
  findings: z.array(FindingSchema).max(30),
}).strict();
