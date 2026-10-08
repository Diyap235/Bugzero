import type { CodeEntityRecord, CodeRelationshipRecord } from '@bugzero/database';

import type { AnalyzerContext } from '../../analyzer-context.js';
import type { FindingCandidate, SeverityLevel } from '../../types.js';

export function getRelationships(context: AnalyzerContext): CodeRelationshipRecord[] {
  return context.repositoryIntelligence?.relationships ?? context.codeIR?.relationships ?? [];
}

export function getRelationshipCount(
  context: AnalyzerContext,
  entity: CodeEntityRecord,
  relation: CodeRelationshipRecord['relation'],
  direction: 'incoming' | 'outgoing',
  targetType?: CodeEntityRecord['entity_type'],
): number {
  const entities = context.repositoryIntelligence?.entities ?? context.codeIR?.entities ?? [];
  const entityById = new Map(entities.map((candidate) => [candidate.id, candidate]));
  const relatedIds = new Set<string>();

  for (const relationship of getRelationships(context)) {
    if (relationship.relation !== relation || relationship.resolution !== 'EXACT') continue;

    const sourceId = direction === 'outgoing' ? relationship.source_entity_id : relationship.target_entity_id;
    const targetId = direction === 'outgoing' ? relationship.target_entity_id : relationship.source_entity_id;
    if (sourceId !== entity.id || targetId === entity.id) continue;

    if (targetType && entityById.get(targetId)?.entity_type !== targetType) continue;
    relatedIds.add(targetId);
  }

  return relatedIds.size;
}

export function createFindingCandidate(
  context: AnalyzerContext,
  target: CodeEntityRecord,
  rule: { id: string; version: string },
  details: {
    title: string;
    description: string;
    severity: SeverityLevel;
    evidenceInputs: Record<string, unknown>;
    fingerprintInputs: Record<string, unknown>;
  },
): FindingCandidate {
  const semanticTarget = target.qualified_name ?? target.name;

  return {
    ruleId: rule.id,
    ruleVersion: rule.version,
    title: details.title,
    description: details.description,
    category: 'STRUCTURAL',
    severity: details.severity,
    confidence: 'HIGH',
    repositoryId: context.repositoryId,
    commitId: context.commitId,
    file: target.file_path,
    startLine: target.start_line,
    endLine: target.end_line,
    semanticTarget,
    evidenceInputs: details.evidenceInputs,
    fingerprintInputs: {
      ruleId: rule.id,
      ruleVersion: rule.version,
      semanticTarget,
      ...details.fingerprintInputs,
    },
  };
}

export function unsupportedRule(diagnostic: string) {
  return { findings: [], diagnostics: [diagnostic], unsupported: true };
}
