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
  readonly provider: 'NVIDIA';
  readonly model: string;
  readonly promptVersion: string;
  investigate(context: AIInvestigationContext, signal?: AbortSignal): Promise<AIInvestigationOutcome>;
  reviewRepository?(
    context: AIRepositoryReviewContext,
    signal?: AbortSignal,
  ): Promise<AIRepositoryReviewOutcome>;
}

export type RepositoryReviewDimension =
  | 'SECURITY'
  | 'QUALITY'
  | 'MAINTAINABILITY'
  | 'RELIABILITY'
  | 'DEPENDENCIES';

export interface AIRepositoryReviewContext {
  analysisStatus: 'COMPLETED' | 'PARTIAL' | 'FAILED';
  sourceFileCount: number;
  parsedFileCount: number;
  files: Array<{
    filePath: string;
    kind: 'SOURCE' | 'DEPENDENCY_MANIFEST';
    source: string;
    truncated?: boolean;
  }>;
}

export interface AIRepositoryReviewFinding {
  dimension: RepositoryReviewDimension;
  title: string;
  severity: 'INFO' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  filePath: string;
  startLine: number;
  endLine: number;
  explanation: string;
  remediation: string;
}

export interface AIRepositoryReviewDimension {
  score: number | null;
  confidence: 'LOW' | 'MEDIUM' | 'HIGH' | null;
  explanation: string;
  evidence: Array<{ filePath: string; line: number }>;
}

export interface AIRepositoryReview {
  dimensions: Record<RepositoryReviewDimension, AIRepositoryReviewDimension>;
  findings: AIRepositoryReviewFinding[];
}

export type AIRepositoryReviewOutcome =
  | { status: 'COMPLETED'; result: AIRepositoryReview; errorCode: null; attempts?: number }
  | { status: 'UNAVAILABLE'; result: null; errorCode: 'MISSING_CONFIGURATION' }
  | {
    status: 'FAILED';
    result: null;
    errorCode: AIInvestigationErrorCode;
    providerStatus?: number;
    attempts?: number;
  };
