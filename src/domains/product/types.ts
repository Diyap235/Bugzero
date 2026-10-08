import type { AIInvestigationRecord } from '@bugzero/contracts';

export interface ApiRepository {
  id: string;
  organizationId: string;
  provider: 'GITHUB' | 'LOCAL';
  externalId: string;
  fullName: string;
  defaultBranch: string;
  cloneUrl: string;
  createdAt: string;
  updatedAt: string;
}

export interface ApiCommit {
  id: string;
  organizationId: string;
  repositoryId: string;
  commitSha: string;
  parentCommitSha: string | null;
  createdAt: string;
  indexedAt: string | null;
}

export interface ApiJob {
  id: string;
  status: 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'RETRY' | 'DEAD_LETTER' | 'CANCELLED';
  stage: string;
  attempt: number;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface AcceptedAnalysis {
  analysisRunId: string;
  jobId: string;
  status: ApiJob["status"];
}

export interface AnalysisRunStatusResponse {
  analysisRunId: string;
  status: ApiRun["status"];
  job: Pick<ApiJob, "id" | "status" | "stage" | "attempt" | "createdAt" | "startedAt" | "finishedAt"> | null;
  progress: Record<string, unknown>;
  failure: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

export interface ApiRun {
  id: string;
  organizationId: string;
  repositoryId: string;
  commitId: string;
  commitSha: string | null;
  profileId: string;
  profileVersion: string;
  scope: string;
  status: 'NOT_STARTED' | 'RUNNING' | 'COMPLETED' | 'PARTIAL' | 'FAILED' | 'UNAVAILABLE';
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  coverage: Record<string, unknown>;
}

export interface ApiFinding {
  id: string;
  organizationId: string;
  repositoryId: string;
  ruleId: string;
  lifecycle: 'OPEN' | 'CONFIRMED' | 'IN_PROGRESS' | 'RESOLVED' | 'DISMISSED' | 'REOPENED';
  currentOccurrenceId: string | null;
  resolutionEvidenceId: string | null;
  currentSeverity: 'INFO' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  currentConfidence: 'LOW' | 'MEDIUM' | 'HIGH';
  currentRisk: number;
  lastSeenRevision: string | null;
  humanDisposition: {
    businessPriority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT' | null;
    acceptedRisk: boolean;
    exceptionId: string | null;
    dispositionReason: string | null;
  };
  createdAt: string;
  updatedAt: string;
}

export interface ApiOccurrence {
  id: string;
  organizationId: string;
  findingId: string;
  repositoryId: string;
  commitId: string;
  analysisRunId: string;
  commitSha: string | null;
  filePath: string | null;
  startLine: number | null;
  endLine: number | null;
  observation: string;
  assessment: {
    severity: ApiFinding['currentSeverity'];
    confidence: ApiFinding['currentConfidence'];
    evidenceStrength: string;
    exploitability: string;
    reachability: string;
    technicalRisk: number;
  };
  fingerprint: {
    ruleId: string;
    semanticTargetId: string;
    normalizedFingerprint: string;
    relationshipFingerprint: string | null;
  };
  resolution: string;
  matchResult: string;
  createdAt: string;
}

export interface ApiEvidenceSnapshot {
  id: string;
  organization_id: string;
  finding_id: string;
  finding_occurrence_id: string;
  analysis_run_id: string;
  repository_id: string;
  commit_id: string;
  identity_fingerprint: string;
  authority: 'AUTHORITATIVE' | 'INVESTIGATIVE';
  origin: string;
  sufficiency: 'SUFFICIENT' | 'INSUFFICIENT' | 'UNKNOWN';
  completeness: 'COMPLETE' | 'PARTIAL' | 'INCOMPLETE';
  complete: boolean;
  diagnostics: string[];
  analyzer_versions: Record<string, unknown>;
  paths: Array<{
    id: string;
    nodeIds: string[];
    edgeIds: string[];
    completeness: string;
    diagnostics: string[];
  }>;
  created_at: string;
}

export interface ApiEvidenceNode {
  organization_id: string;
  evidence_id: string;
  node_key: string;
  node_type: string;
  label: string;
  file_path: string | null;
  line: number | null;
  end_line: number | null;
  start_column: number | null;
  end_column: number | null;
  attributes: Record<string, unknown>;
}

export interface ApiEvidenceEdge {
  organization_id: string;
  evidence_id: string;
  edge_key: string;
  from_node_key: string;
  to_node_key: string;
  relation: string;
  resolution: string;
  confidence: string;
  attributes: Record<string, unknown>;
}

export interface ApiRiskAssessment {
  id: string;
  organization_id: string;
  finding_id: string;
  finding_occurrence_id: string;
  evidence_id: string;
  repository_id: string;
  commit_id: string;
  analysis_run_id: string;
  profile_id: string;
  profile_version: number;
  model_version: string;
  severity: string;
  confidence: string;
  evidence_strength: string;
  evidence_authority: string;
  evidence_sufficiency: string;
  evidence_completeness: string;
  reachability: string;
  exploitability: string;
  dependency_exposure: 'UNKNOWN';
  affected_module_count: null;
  technical_risk: number;
  risk_band: string;
  profile_snapshot: Record<string, unknown>;
  factors: Record<string, unknown>;
  calculation: Record<string, unknown>;
  explanation: string;
  assessed_at: string;
}

export interface ApiHealthSnapshot {
  id: string;
  organization_id: string;
  repository_id: string;
  commit_id: string;
  analysis_run_id: string | null;
  profile_id: string | null;
  profile_version: number | null;
  model_version: string | null;
  overall_score: number | null;
  overall_status: string | null;
  coverage: 'COMPLETE' | 'PARTIAL' | 'UNKNOWN' | null;
  dimensions: Record<string, {
    score: number | null;
    status: string;
    coverage: string;
    confidence: number | null;
    inputMetrics: Record<string, unknown>;
    explanation: string;
  }> | null;
  profile_snapshot: Record<string, unknown> | null;
  calculation: Record<string, unknown> | null;
  explanation: string | null;
  security_score: number | null;
  quality_score: number | null;
  reliability_score: number | null;
  maintainability_score: number | null;
  dependency_score: number | null;
  created_at: string;
}

export interface RepositoryOverview {
  repository: ApiRepository;
  latestCommit: ApiCommit | null;
  latestRun: (ApiRun & { job: ApiJob | null }) | null;
  latestHealth: ApiHealthSnapshot | null;
  findingCounts: { total: number; open: number; critical: number; highRisk: number };
}

export interface FindingRow {
  finding: ApiFinding;
  occurrence: ApiOccurrence | null;
}

export interface FindingDetail {
  title?: string;
  description?: string | null;
  location?: {
    filePath: string | null;
    startLine: number | null;
    endLine: number | null;
  } | null;
  finding: ApiFinding;
  occurrence: ApiOccurrence | null;
  evidence: {
    snapshot: ApiEvidenceSnapshot;
    nodes: ApiEvidenceNode[];
    edges: ApiEvidenceEdge[];
  } | null;
  risks: ApiRiskAssessment[];
  aiInvestigations: AIInvestigationRecord[];
  risk?: ApiRiskAssessment | null;
  aiInvestigationStatus?: 'NOT_REQUESTED' | 'UNAVAILABLE' | 'COMPLETED' | 'PARTIAL' | 'FAILED' | null;
  mlSignalStatus?: 'AVAILABLE' | 'UNAVAILABLE' | 'NOT_APPLICABLE' | null;
  mlSignal?: {
    classification: 'INVESTIGATIVE';
    modelVersion: string;
    label: 'safe' | 'vulnerable';
    score: number;
    timestamp: string | null;
    function: {
      functionName: string | null;
      filePath: string;
      startLine: number;
      endLine: number;
    };
  } | null;
  aiExplanation?: {
    classification: 'EXPLANATORY';
    provider: 'GROQ' | null;
    model: string | null;
    status: 'PENDING' | 'COMPLETED' | 'FAILED' | null;
    summary: string | null;
    explanation: string | null;
    attackPath: string[];
    reasoningStatus: 'SUPPORTED' | 'INVESTIGATIVE' | 'INSUFFICIENT_EVIDENCE' | null;
  } | null;
  recommendedFix?: string[] | null;
}

export interface RepositoryHistoryEntry {
  run: ApiRun;
  job: ApiJob | null;
  findingCount: number;
  totalTechnicalRisk: number;
  healthScore: number | null;
}

export interface HealthHistoryEntry {
  snapshot: ApiHealthSnapshot;
  commitSha: string | null;
}

export interface ApiReport {
  id: string;
  organizationId: string;
  repositoryId: string;
  analysisRunId: string;
  createdByUserId: string | null;
  format: "JSON" | "PDF" | "HTML";
  metadata: Record<string, unknown>;
  createdAt: string;
}

export type AnalysisStatus = AnalysisRunStatusResponse;
