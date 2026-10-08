import { z } from 'zod';

import { UUID, ResolutionState } from '../common/enums.js';

export const AnalysisScopeModeSchema = z.enum(['FULL', 'FILE', 'ENTITY', 'IMPACTED']);
export const DependencyRelationshipKindSchema = z.enum(['DIRECT', 'TRANSITIVE']);
export const ImpactReasonKindSchema = z.enum([
  'CHANGE_ENTITY',
  'CALLER_OF_CHANGED_ENTITY',
  'CALLEE_OF_CHANGED_ENTITY',
  'IMPORTER_OF_CHANGED_ENTITY',
  'IMPORTS_CHANGED_ENTITY',
  'REFERENCE_TO_CHANGED_ENTITY',
  'INHERITOR_OF_CHANGED_ENTITY',
  'IMPLEMENTER_OF_CHANGED_ENTITY',
]);

export const ImpactReasonSchema = z.object({
  entityId: z.string().min(1),
  entityQualifiedName: z.string().min(1).optional(),
  reason: ImpactReasonKindSchema,
  distance: z.number().int().nonnegative(),
  relationship: z.string().min(1),
  resolution: ResolutionState,
});

export const AnalysisScopeDefinitionSchema = z.object({
  mode: AnalysisScopeModeSchema,
  entityIds: z.array(z.string()).default([]),
  fileIds: z.array(z.string()).default([]),
  reason: z.string().min(1).optional(),
  complete: z.boolean().default(false),
});

export const ImpactAnalysisResultSchema = z.object({
  repositoryId: UUID,
  commitId: UUID,
  changedEntities: z.array(z.string()),
  affectedEntities: z.array(z.string()),
  affectedFiles: z.array(z.string()),
  traversedRelationships: z.array(z.string()),
  unresolvedRelationships: z.array(z.string()),
  maxDepth: z.number().int().nonnegative(),
  maxEntities: z.number().int().nonnegative(),
  maxFiles: z.number().int().nonnegative(),
  truncated: z.boolean().default(false),
  complete: z.boolean().default(false),
  requiresScopeExpansion: z.boolean().default(false),
  reasons: z.array(ImpactReasonSchema),
  scope: AnalysisScopeDefinitionSchema.optional(),
});

export type AnalysisScopeMode = z.infer<typeof AnalysisScopeModeSchema>;
export type DependencyRelationshipKind = z.infer<typeof DependencyRelationshipKindSchema>;
export type ImpactReasonKind = z.infer<typeof ImpactReasonKindSchema>;
export type ImpactReason = z.infer<typeof ImpactReasonSchema>;
export type AnalysisScopeDefinition = z.infer<typeof AnalysisScopeDefinitionSchema>;
export type ImpactAnalysisResult = z.infer<typeof ImpactAnalysisResultSchema>;
