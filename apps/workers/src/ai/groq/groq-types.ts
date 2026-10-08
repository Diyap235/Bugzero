import type { AIInvestigationResult } from '@bugzero/contracts';
import type { AIInvestigationErrorCode } from '@bugzero/database';

export interface AIInvestigationEvidenceNode {
  nodeKey: string;
  nodeType: string;
  label: string;
  filePath: string | null;
  line: number | null;
  endLine: number | null;
  attributes: Record<string, unknown>;
}

export interface AIInvestigationEvidenceEdge {
  fromNodeKey: string;
  toNodeKey: string;
  relation: string;
  resolution: string;
  confidence: string;
}

export interface AIInvestigationContext {
  analysisStatus: 'NOT_STARTED' | 'RUNNING' | 'COMPLETED' | 'PARTIAL' | 'FAILED' | 'UNAVAILABLE';
  finding: {
    ruleId: string;
    severity: string;
    confidence: string;
    filePath: string | null;
    startLine: number | null;
    endLine: number | null;
  };
  evidence: {
    authority: string;
    sufficiency: string;
    completeness: string;
    diagnostics: string[];
    paths: Array<{
      nodeIds: string[];
      edgeIds: string[];
      completeness: string;
      diagnostics: string[];
    }>;
    nodes: AIInvestigationEvidenceNode[];
    edges: AIInvestigationEvidenceEdge[];
  };
  languages: string[];
  sourceSnippets: Array<{
    filePath: string;
    startLine: number;
    source: string;
  }>;
}

export type AIInvestigationOutcome =
  | { status: 'COMPLETED'; result: AIInvestigationResult; errorCode: null }
  | { status: 'UNAVAILABLE'; result: null; errorCode: 'MISSING_CONFIGURATION' }
  | {
    status: 'FAILED';
    result: null;
    errorCode: AIInvestigationErrorCode;
  };

export interface AIInvestigator {
  readonly enabled: boolean;
  readonly availability: 'ENABLED' | 'MISSING_CONFIGURATION' | 'INVALID_CONFIGURATION';
  readonly provider: 'GROQ';
  readonly model: string;
  readonly promptVersion: string;
  investigate(context: AIInvestigationContext): Promise<AIInvestigationOutcome>;
}
