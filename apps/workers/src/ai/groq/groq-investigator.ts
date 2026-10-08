import { createHash } from 'node:crypto';

import type {
  AIInvestigationRepository,
  EvidenceGraphRecord,
  EvidenceRecord,
  Finding,
  FindingOccurrence,
} from '@bugzero/database';

import type { SourceAccess } from '../../analyzers/source-access.js';
import type { AIInvestigationContext, AIInvestigator } from './groq-types.js';

const MAX_GRAPH_NODES = 24;
const MAX_GRAPH_EDGES = 32;
const MAX_EVIDENCE_PATHS = 6;
const MAX_SOURCE_SNIPPETS = 6;
const MAX_SOURCE_LINES = 8;
const MAX_SOURCE_CHARACTERS = 8_000;

type FindingLookup = Pick<import('@bugzero/database').FindingRepository, 'getById' | 'getOccurrencesForFinding'>;
type EvidenceLookup = Pick<import('@bugzero/database').EvidenceRepository, 'getEvidenceForFinding' | 'getSnapshot'>;
type InvestigationStore = Pick<AIInvestigationRepository, 'getByIdempotencyKey' | 'createOrGet'>;

function clipped(value: string, maximum: number): string {
  return value.length > maximum ? `${value.slice(0, maximum)}…` : value;
}

function safeSourcePath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/');
  return normalized.length > 0
    && !normalized.startsWith('/')
    && !/^[A-Za-z]:/.test(normalized)
    && !normalized.split('/').some((segment) => segment === '.' || segment === '..')
    && !/(?:^|\/)\.env(?:\.|$)|secret|credential|private[-_]?key/i.test(normalized);
}

function sourceLanguage(filePath: string): string | null {
  const extension = filePath.split('.').pop()?.toLowerCase();
  if (extension === 'py') return 'Python';
  if (extension === 'js' || extension === 'jsx') return 'JavaScript';
  if (extension === 'ts' || extension === 'tsx') return 'TypeScript';
  return null;
}

function redactSourceSecrets(source: string): string {
  return source
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[REDACTED PRIVATE KEY]')
    .replace(/(\b(?:api[_-]?key|access[_-]?token|auth[_-]?token|password|passwd|secret|client[_-]?secret)\b\s*[:=]\s*)(["'`])[^"'`\r\n]*\2/gi, '$1"[REDACTED]"')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]');
}

async function buildSourceSnippets(
  sourceAccess: SourceAccess,
  occurrence: FindingOccurrence,
  graph: EvidenceGraphRecord,
): Promise<AIInvestigationContext['sourceSnippets']> {
  const locations = new Map<string, number>();
  if (occurrence.file_path && occurrence.start_line) locations.set(occurrence.file_path, occurrence.start_line);
  for (const node of graph.nodes) {
    if (node.file_path && node.line && !locations.has(node.file_path)) {
      locations.set(node.file_path, node.line);
    }
  }

  const snippets: AIInvestigationContext['sourceSnippets'] = [];
  let totalCharacters = 0;
  for (const [filePath, line] of locations) {
    if (snippets.length >= MAX_SOURCE_SNIPPETS || totalCharacters >= MAX_SOURCE_CHARACTERS) break;
    if (!safeSourcePath(filePath)) continue;
    try {
      const metadata = await sourceAccess.getSourceMetadata(filePath);
      if (!metadata.exists || metadata.lineCount < 1) continue;
      const startLine = Math.max(1, line - 2);
      const endLine = Math.min(metadata.lineCount, startLine + MAX_SOURCE_LINES - 1);
      const sourceLines = await sourceAccess.getLineRange(filePath, startLine, endLine);
      if (sourceLines.length === 0) continue;
      const remaining = MAX_SOURCE_CHARACTERS - totalCharacters;
      const source = clipped(redactSourceSecrets(sourceLines.join('\n')), remaining);
      totalCharacters += source.length;
      snippets.push({
        filePath: clipped(filePath, 240),
        startLine,
        source,
      });
    } catch {
      continue;
    }
  }
  return snippets;
}

export async function buildAIInvestigationContext(input: {
  analysisStatus: AIInvestigationContext['analysisStatus'];
  finding: Finding;
  occurrence: FindingOccurrence;
  evidence: EvidenceRecord;
  graph: EvidenceGraphRecord;
  sourceAccess: SourceAccess;
}): Promise<AIInvestigationContext> {
  const nodes = input.graph.nodes.slice(0, MAX_GRAPH_NODES).map((node) => ({
    nodeKey: clipped(node.node_key, 160),
    nodeType: node.node_type,
    label: clipped(node.label, 240),
    filePath: node.file_path ? clipped(node.file_path, 240) : null,
    line: node.line,
    endLine: node.end_line,
    attributes: Object.fromEntries(
      ['resolution', 'confidence', 'provenance', 'sourceProvenance']
        .filter((key) => typeof node.attributes[key] === 'string')
        .map((key) => [key, clipped(String(node.attributes[key]), 80)]),
    ),
  }));
  const allowedNodeKeys = new Set(nodes.map((node) => node.nodeKey));
  const edges = input.graph.edges
    .filter((edge) => allowedNodeKeys.has(edge.from_node_key) && allowedNodeKeys.has(edge.to_node_key))
    .slice(0, MAX_GRAPH_EDGES)
    .map((edge) => ({
      fromNodeKey: edge.from_node_key,
      toNodeKey: edge.to_node_key,
      relation: clipped(edge.relation, 100),
      resolution: edge.resolution,
      confidence: edge.confidence,
    }));
  const snippets = await buildSourceSnippets(input.sourceAccess, input.occurrence, input.graph);
  return {
    analysisStatus: input.analysisStatus,
    finding: {
      ruleId: clipped(input.finding.rule_id, 160),
      severity: input.occurrence.severity,
      confidence: input.occurrence.confidence,
      filePath: input.occurrence.file_path ? clipped(input.occurrence.file_path, 240) : null,
      startLine: input.occurrence.start_line,
      endLine: input.occurrence.end_line,
    },
    evidence: {
      authority: input.evidence.authority,
      sufficiency: input.evidence.sufficiency,
      completeness: input.evidence.completeness,
      diagnostics: input.evidence.diagnostics.slice(0, 8).map((item) => clipped(item, 300)),
      paths: input.evidence.paths.slice(0, MAX_EVIDENCE_PATHS).map((path) => ({
        nodeIds: path.nodeIds.slice(0, MAX_GRAPH_NODES).map((item) => clipped(item, 160)),
        edgeIds: path.edgeIds.slice(0, MAX_GRAPH_EDGES).map((item) => clipped(item, 160)),
        completeness: path.completeness,
        diagnostics: path.diagnostics.slice(0, 4).map((item) => clipped(item, 240)),
      })),
      nodes,
      edges,
    },
    languages: Array.from(new Set(snippets.map((snippet) => sourceLanguage(snippet.filePath))
      .filter((language): language is string => language !== null))).slice(0, 8),
    sourceSnippets: snippets,
  };
}

function idempotencyKey(input: {
  organizationId: string;
  repositoryId: string;
  commitId: string;
  findingId: string;
  occurrenceId: string;
  evidenceId: string;
  promptVersion: string;
  model: string;
}): string {
  return createHash('sha256').update(JSON.stringify([
    input.organizationId,
    input.repositoryId,
    input.commitId,
    input.findingId,
    input.occurrenceId,
    input.evidenceId,
    input.promptVersion,
    input.model,
  ])).digest('hex');
}

export interface FindingInvestigationSummary {
  status: 'NOT_REQUESTED' | 'UNAVAILABLE' | 'COMPLETED' | 'PARTIAL' | 'FAILED';
  attempted: number;
  completed: number;
  failed: number;
  reused: number;
}

export async function investigatePersistedFindings(input: {
  organizationId: string;
  repositoryId: string;
  commitId: string;
  analysisRunId: string;
  analysisStatus: AIInvestigationContext['analysisStatus'];
  findingIds: string[];
  sourceAccess: SourceAccess;
  investigator: AIInvestigator;
  findings: FindingLookup;
  evidence: EvidenceLookup;
  investigations: InvestigationStore;
}): Promise<FindingInvestigationSummary> {
  if (input.findingIds.length === 0) {
    return { status: 'NOT_REQUESTED', attempted: 0, completed: 0, failed: 0, reused: 0 };
  }
  if (!input.investigator.enabled) {
    return {
      status: input.investigator.availability === 'INVALID_CONFIGURATION' ? 'FAILED' : 'UNAVAILABLE',
      attempted: 0,
      completed: 0,
      failed: 0,
      reused: 0,
    };
  }

  let attempted = 0;
  let completed = 0;
  let failed = 0;
  let reused = 0;
  for (const findingId of new Set(input.findingIds)) {
    try {
      const finding = await input.findings.getById(input.organizationId, findingId);
      if (!finding) {
        failed += 1;
        continue;
      }
      const occurrences = await input.findings.getOccurrencesForFinding(input.organizationId, finding.id);
      const occurrence = occurrences.find((item) =>
        item.analysis_run_id === input.analysisRunId)
        ?? occurrences.find((item) => item.commit_id === input.commitId);
      if (!occurrence) {
        failed += 1;
        continue;
      }
      const evidenceRecords = await input.evidence.getEvidenceForFinding(input.organizationId, finding.id);
      const evidence = evidenceRecords.find((item) => item.finding_occurrence_id === occurrence.id);
      if (!evidence) {
        failed += 1;
        continue;
      }
      const graph = await input.evidence.getSnapshot(input.organizationId, evidence.id);
      if (!graph) {
        failed += 1;
        continue;
      }
      const context = await buildAIInvestigationContext({
        analysisStatus: input.analysisStatus,
        finding,
        occurrence,
        evidence,
        graph,
        sourceAccess: input.sourceAccess,
      });
      const identity = {
        organizationId: input.organizationId,
        repositoryId: input.repositoryId,
        commitId: input.commitId,
        findingId: finding.id,
        occurrenceId: occurrence.id,
        evidenceId: evidence.id,
        promptVersion: input.investigator.promptVersion,
        model: input.investigator.model,
      };
      const existing = await input.investigations.getByIdempotencyKey(
        input.organizationId,
        occurrence.id,
        idempotencyKey(identity),
      );
      if (existing) {
        reused += 1;
        if (existing.status === 'FAILED') failed += 1;
        else if (existing.status === 'COMPLETED') completed += 1;
        continue;
      }

      attempted += 1;
      let outcome;
      try {
        outcome = await input.investigator.investigate(context);
      } catch {
        outcome = { status: 'FAILED' as const, result: null, errorCode: 'PROVIDER_ERROR' as const };
      }
      const stored = await input.investigations.createOrGet({
        ...identity,
        provider: input.investigator.provider,
        findingOccurrenceId: occurrence.id,
        evidenceId: evidence.id,
        promptVersion: input.investigator.promptVersion,
        idempotencyKey: idempotencyKey(identity),
        result: outcome.result,
        errorCode: outcome.errorCode,
      });
      if (!stored.created) {
        reused += 1;
        if (stored.record.status === 'FAILED') failed += 1;
        else if (stored.record.status === 'COMPLETED') completed += 1;
        continue;
      }
      if (outcome.status === 'COMPLETED') completed += 1;
      else failed += 1;
    } catch (error) {
      const details = error as { code?: unknown; constraint?: unknown };
      failed += 1;
      console.error(JSON.stringify({
        event: 'ai.investigation.failed',
        findingId,
        errorName: error instanceof Error ? error.name : 'UnknownError',
        errorCode: typeof details.code === 'string' ? details.code : undefined,
        constraint: typeof details.constraint === 'string' ? details.constraint : undefined,
      }));
    }
  }
  const status = failed === 0
    ? 'COMPLETED' as const
    : completed > 0 ? 'PARTIAL' as const : 'FAILED' as const;
  return { status, attempted, completed, failed, reused };
}
