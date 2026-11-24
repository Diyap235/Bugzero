export type AnalyzerTypeName = 'STRUCTURAL' | 'QUALITY' | 'SECURITY' | 'DEPENDENCY' | 'TAINT';
export type AnalyzerStatus = 'COMPLETED' | 'PARTIAL' | 'FAILED';
export type SeverityLevel = 'INFO' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type ConfidenceLevel = 'LOW' | 'MEDIUM' | 'HIGH';
export type ScopeMode = 'FULL' | 'FILE' | 'ENTITY' | 'IMPACTED';

export interface AnalyzerMetadata {
  name: string;
  version: string;
  type: AnalyzerTypeName;
  supportedLanguages: string[];
  requiredIR: string[];
  supportedScopes: ScopeMode[];
  resourceCost: 'LOW' | 'MEDIUM' | 'HIGH';
  supportsIncremental: boolean;
}

export interface ResourceBudget {
  maxFiles: number;
  maxEntities: number;
  maxDurationMs: number;
}

export interface CandidateEvidenceNode {
  nodeKey: string;
  nodeType: import('@bugzero/database').EvidenceNodeType;
  label: string;
  filePath: string | null;
  line: number | null;
  endLine?: number | null;
  attributes: Record<string, unknown>;
}

export interface CandidateEvidenceEdge {
  edgeKey: string;
  fromNodeKey: string;
  toNodeKey: string;
  relation: string;
  resolution: import('@bugzero/database').EvidenceResolution;
  confidence: import('@bugzero/database').EvidenceConfidence;
  attributes: Record<string, unknown>;
}

export interface CandidateEvidenceGraph {
  nodes: CandidateEvidenceNode[];
  edges: CandidateEvidenceEdge[];
  paths: import('@bugzero/database').EvidencePathRecord[];
  completeness: 'COMPLETE' | 'PARTIAL' | 'INCOMPLETE';
  sufficiency: 'SUFFICIENT' | 'INSUFFICIENT' | 'UNKNOWN';
  diagnostics: string[];
}

export interface FindingCandidate {
  ruleId: string;
  ruleVersion: string;
  title: string;
  description: string;
  category: 'STRUCTURAL' | 'QUALITY' | 'SECURITY';
  severity: SeverityLevel;
  confidence: ConfidenceLevel;
  repositoryId: string;
  commitId: string;
  file: string | null;
  startLine: number | null;
  endLine: number | null;
  semanticTarget: string | null;
  evidenceInputs: Record<string, unknown>;
  fingerprintInputs: Record<string, unknown>;
  evidenceGraph?: CandidateEvidenceGraph;
}

export interface AnalyzerResult {
  status: AnalyzerStatus;
  findings: FindingCandidate[];
  diagnostics: string[];
  metrics: {
    durationMs: number;
    filesAnalyzed: number;
    entitiesAnalyzed: number;
    rulesExecuted: number;
    findingsProduced: number;
    taintNodes?: number;
    taintEdges?: number;
    paths?: number;
  };
}

export interface RuleEvaluationResult {
  findings: FindingCandidate[];
  diagnostics: string[];
  unsupported: boolean;
}

export interface Rule<TTarget = unknown, TContext = unknown> {
  id: string;
  version: string;
  name: string;
  category: 'STRUCTURAL' | 'QUALITY' | 'SECURITY';
  supportedLanguages: string[];
  evaluate(context: TContext, target: TTarget): RuleEvaluationResult | Promise<RuleEvaluationResult>;
}

export interface Analyzer {
  metadata: AnalyzerMetadata;
  analyze(context: unknown): AnalyzerResult | Promise<AnalyzerResult>;
}
