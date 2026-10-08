import { z } from 'zod';

import { UUID } from '../common/enums.js';

export const CodeEntityKindSchema = z.enum([
  'REPOSITORY',
  'FILE',
  'MODULE',
  'NAMESPACE',
  'CLASS',
  'FUNCTION',
  'METHOD',
  'VARIABLE',
  'PARAMETER',
  'TYPE',
  'CONSTANT',
  'INTERFACE',
]);

export const CodeRelationshipKindSchema = z.enum([
  'DECLARES',
  'IMPORTS',
  'CALLS',
  'REFERENCES',
  'READS',
  'WRITES',
  'RETURNS',
  'PASSES_ARGUMENT',
  'INHERITS',
  'IMPLEMENTS',
  'OVERRIDES',
]);

export const ResolutionStateSchema = z.enum(['EXACT', 'INFERRED', 'POSSIBLE', 'UNKNOWN']);
export const ParseStatusSchema = z.enum(['PARSED', 'PARTIAL', 'FAILED', 'UNSUPPORTED']);

export const CodeEntitySchema = z.object({
  id: z.string().min(1),
  repositoryId: UUID,
  commitId: UUID,
  filePath: z.string().min(1),
  kind: CodeEntityKindSchema,
  name: z.string().min(1),
  qualifiedName: z.string().min(1),
  language: z.string().min(1),
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
  startColumn: z.number().int().nonnegative(),
  endColumn: z.number().int().nonnegative(),
  sourceFingerprint: z.string().min(1),
  provenance: z.record(z.unknown()).default({}),
});

export const CodeRelationshipSchema = z.object({
  id: z.string().min(1),
  sourceEntityId: z.string().min(1),
  targetEntityId: z.string().min(1),
  kind: CodeRelationshipKindSchema,
  resolution: ResolutionStateSchema,
  confidence: z.number().min(0).max(1).optional(),
  provenance: z.record(z.unknown()).default({}),
});

export const ParseResultSchema = z.object({
  status: ParseStatusSchema,
  language: z.string().min(1),
  parserVersion: z.string().min(1),
  irVersion: z.string().min(1),
  durationMs: z.number().int().nonnegative(),
  entityCount: z.number().int().nonnegative(),
  relationshipCount: z.number().int().nonnegative(),
  entities: z.array(CodeEntitySchema),
  relationships: z.array(CodeRelationshipSchema),
  diagnostics: z.array(z.string()),
  cacheKey: z.string().min(1),
});

export type CodeEntity = z.infer<typeof CodeEntitySchema>;
export type CodeRelationship = z.infer<typeof CodeRelationshipSchema>;
export type ParseStatus = z.infer<typeof ParseStatusSchema>;
export type ParseResult = z.infer<typeof ParseResultSchema>;
