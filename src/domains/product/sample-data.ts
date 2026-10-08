import type {
  ApiCommit,
  ApiEvidenceEdge,
  ApiEvidenceNode,
  ApiEvidenceSnapshot,
  ApiFinding,
  ApiHealthSnapshot,
  ApiJob,
  ApiOccurrence,
  ApiRepository,
  ApiRiskAssessment,
  ApiRun,
  AnalysisRunStatusResponse,
  FindingDetail,
  FindingRow,
  HealthHistoryEntry,
  RepositoryHistoryEntry,
  RepositoryOverview,
} from "./types";

const createdAt = "2025-01-15T12:00:00.000Z";
const sampleOrganizationId = "sample-organization";
const sampleRepositoryId = "sample-repository";
const sampleCommitId = "sample-commit";
const sampleRunId = "sample-analysis";

export const sampleCodeLines = [
  { n: 1, text: "import { db } from \"../database\";", type: "import" },
  { n: 2, text: "", type: "blank" },
  { n: 3, text: "export async function getUser(request) {", type: "def" },
  { n: 4, text: "  const userId = request.query.userId;", type: "code" },
  { n: 5, text: "  const query = `SELECT * FROM users", type: "danger" },
  { n: 6, text: "    WHERE id = ${userId}`;", type: "danger" },
  { n: 7, text: "  return db.execute(query);", type: "danger" },
  { n: 8, text: "}", type: "code" },
];

export const sampleRepository: ApiRepository & { languages: string[] } = {
  id: sampleRepositoryId,
  organizationId: sampleOrganizationId,
  provider: "GITHUB",
  externalId: "bugzero-demo",
  fullName: "bugzero-demo",
  defaultBranch: "main",
  cloneUrl: "https://github.com/bugzero-demo",
  createdAt,
  updatedAt: createdAt,
  languages: ["TypeScript", "Python"],
};

const sampleCommit: ApiCommit = {
  id: sampleCommitId,
  organizationId: sampleOrganizationId,
  repositoryId: sampleRepositoryId,
  commitSha: "demo000000000000000000000000000000000000",
  parentCommitSha: null,
  createdAt,
  indexedAt: createdAt,
};

const sampleJob: ApiJob = {
  id: "sample-analysis-job",
  status: "COMPLETED",
  stage: "COMPLETED",
  attempt: 1,
  createdAt,
  startedAt: createdAt,
  finishedAt: createdAt,
};

const sampleRun: ApiRun = {
  id: sampleRunId,
  organizationId: sampleOrganizationId,
  repositoryId: sampleRepositoryId,
  commitId: sampleCommitId,
  commitSha: sampleCommit.commitSha,
  profileId: "default",
  profileVersion: "1",
  scope: "COMMIT",
  status: "COMPLETED",
  createdAt,
  startedAt: createdAt,
  completedAt: createdAt,
  coverage: { sourceFiles: 42, parsedFiles: 42 },
};

const dimension = (score: number | null, explanation: string) => ({
  score,
  status: score === null ? "UNKNOWN" : "ASSESSED",
  coverage: score === null ? "UNKNOWN" : "PARTIAL",
  confidence: score === null ? null : 0.82,
  inputMetrics: score === null ? {} : { score },
  explanation,
});

const healthSnapshot: ApiHealthSnapshot = {
  id: "sample-health-current",
  organization_id: sampleOrganizationId,
  repository_id: sampleRepositoryId,
  commit_id: sampleCommitId,
  analysis_run_id: sampleRunId,
  profile_id: "default",
  profile_version: 1,
  model_version: "sample-v1",
  overall_score: 82,
  overall_status: "ASSESSED",
  coverage: "PARTIAL",
  dimensions: {
    security: {
      ...dimension(88, "Security checks cover the sample repository's analyzed source."),
      inputMetrics: { score: 88 },
    },
    quality: {
      ...dimension(79, "Quality checks cover the sample repository's analyzed source."),
      inputMetrics: { score: 79, coveragePercent: 74 },
    },
    maintainability: dimension(80, "Maintainability indicators are available for the sample."),
    reliability: dimension(null, "No reliability assessment is included in this sample."),
    dependencies: dimension(null, "No dependency assessment is included in this sample."),
  },
  profile_snapshot: { id: "default", version: 1 },
  calculation: { method: "sample" },
  explanation: "A demonstration snapshot showing assessed and unknown dimensions.",
  security_score: 88,
  quality_score: 79,
  reliability_score: null,
  maintainability_score: 80,
  dependency_score: null,
  created_at: createdAt,
};

export const sampleOverview: RepositoryOverview = {
  repository: sampleRepository,
  latestCommit: sampleCommit,
  latestRun: { ...sampleRun, job: sampleJob },
  latestHealth: healthSnapshot,
  findingCounts: { total: 3, open: 3, critical: 1, highRisk: 1 },
};

function makeFinding(
  id: string,
  ruleId: string,
  severity: ApiFinding["currentSeverity"],
  confidence: ApiFinding["currentConfidence"],
  risk: number,
  filePath: string,
  line: number,
): FindingRow {
  const finding: ApiFinding = {
    id,
    organizationId: sampleOrganizationId,
    repositoryId: sampleRepositoryId,
    ruleId,
    lifecycle: "OPEN",
    currentOccurrenceId: `${id}-occurrence`,
    resolutionEvidenceId: null,
    currentSeverity: severity,
    currentConfidence: confidence,
    currentRisk: risk,
    lastSeenRevision: sampleCommit.commitSha,
    humanDisposition: {
      businessPriority: severity === "CRITICAL" ? "URGENT" : null,
      acceptedRisk: false,
      exceptionId: null,
      dispositionReason: null,
    },
    createdAt,
    updatedAt: createdAt,
  };
  const occurrence: ApiOccurrence = {
    id: `${id}-occurrence`,
    organizationId: sampleOrganizationId,
    findingId: id,
    repositoryId: sampleRepositoryId,
    commitId: sampleCommitId,
    analysisRunId: sampleRunId,
    commitSha: sampleCommit.commitSha,
    filePath,
    startLine: line,
    endLine: line,
    observation: `${ruleId} detected in the sample repository.`,
    assessment: {
      severity,
      confidence,
      evidenceStrength: id === "sample-sql-injection" ? "STRONG" : "LIMITED",
      exploitability: id === "sample-sql-injection" ? "HIGH" : "LOW",
      reachability: id === "sample-sql-injection" ? "REACHABLE" : "UNKNOWN",
      technicalRisk: risk,
    },
    fingerprint: {
      ruleId,
      semanticTargetId: `${id}-target`,
      normalizedFingerprint: `${id}-fingerprint`,
      relationshipFingerprint: null,
    },
    resolution: "RESOLVED",
    matchResult: "MATCHED",
    createdAt,
  };
  return { finding, occurrence };
}

export const sampleFindings: FindingRow[] = [
  makeFinding("sample-sql-injection", "SQL_INJECTION", "CRITICAL", "HIGH", 87, "src/api/users.ts", 42),
  makeFinding("sample-long-function", "LONG_FUNCTION", "MEDIUM", "MEDIUM", 51, "src/services/users.ts", 88),
  makeFinding("sample-parameter-count", "HIGH_PARAMETER_COUNT", "LOW", "MEDIUM", 28, "src/utils/query.ts", 16),
];

const evidenceNodes: ApiEvidenceNode[] = [
  {
    organization_id: sampleOrganizationId,
    evidence_id: "sample-sql-evidence",
    node_key: "request",
    node_type: "HTTP_REQUEST",
    label: "HTTP Request",
    file_path: "src/api/users.ts",
    line: 38,
    end_line: 38,
    start_column: null,
    end_column: null,
    attributes: { resolution: "RESOLVED" },
  },
  {
    organization_id: sampleOrganizationId,
    evidence_id: "sample-sql-evidence",
    node_key: "parameter",
    node_type: "REQUEST_PARAMETER",
    label: "userId parameter",
    file_path: "src/api/users.ts",
    line: 39,
    end_line: 39,
    start_column: null,
    end_column: null,
    attributes: { resolution: "RESOLVED" },
  },
  {
    organization_id: sampleOrganizationId,
    evidence_id: "sample-sql-evidence",
    node_key: "function",
    node_type: "FUNCTION",
    label: "getUser",
    file_path: "src/api/users.ts",
    line: 40,
    end_line: 45,
    start_column: null,
    end_column: null,
    attributes: { resolution: "RESOLVED" },
  },
  {
    organization_id: sampleOrganizationId,
    evidence_id: "sample-sql-evidence",
    node_key: "query",
    node_type: "SQL_SINK",
    label: "Database Query",
    file_path: "src/api/users.ts",
    line: 42,
    end_line: 42,
    start_column: null,
    end_column: null,
    attributes: { resolution: "RESOLVED" },
  },
];

const evidenceEdges: ApiEvidenceEdge[] = [
  ["request", "parameter", "CONTAINS_PARAMETER"],
  ["parameter", "function", "FLOWS_TO"],
  ["function", "query", "REACHES_SINK"],
].map(([from_node_key, to_node_key, relation]) => ({
  organization_id: sampleOrganizationId,
  evidence_id: "sample-sql-evidence",
  edge_key: `${from_node_key}-${to_node_key}`,
  from_node_key,
  to_node_key,
  relation,
  resolution: "RESOLVED",
  confidence: "HIGH",
  attributes: {},
}));

const evidenceSnapshot: ApiEvidenceSnapshot = {
  id: "sample-sql-evidence",
  organization_id: sampleOrganizationId,
  finding_id: "sample-sql-injection",
  finding_occurrence_id: "sample-sql-injection-occurrence",
  analysis_run_id: sampleRunId,
  repository_id: sampleRepositoryId,
  commit_id: sampleCommitId,
  identity_fingerprint: "sample-sql-evidence-fingerprint",
  authority: "AUTHORITATIVE",
  origin: "SECURITY_ANALYZER",
  sufficiency: "SUFFICIENT",
  completeness: "COMPLETE",
  complete: true,
  diagnostics: [],
  analyzer_versions: { SQL_INJECTION: "1" },
  paths: [{
    id: "request-to-query",
    nodeIds: ["request", "parameter", "function", "query"],
    edgeIds: ["request-parameter", "parameter-function", "function-query"],
    completeness: "COMPLETE",
    diagnostics: [],
  }],
  created_at: createdAt,
};

const riskAssessment: ApiRiskAssessment = {
  id: "sample-sql-risk",
  organization_id: sampleOrganizationId,
  finding_id: "sample-sql-injection",
  finding_occurrence_id: "sample-sql-injection-occurrence",
  evidence_id: evidenceSnapshot.id,
  repository_id: sampleRepositoryId,
  commit_id: sampleCommitId,
  analysis_run_id: sampleRunId,
  profile_id: "default",
  profile_version: 1,
  model_version: "sample-v1",
  severity: "CRITICAL",
  confidence: "HIGH",
  evidence_strength: "STRONG",
  evidence_authority: "AUTHORITATIVE",
  evidence_sufficiency: "SUFFICIENT",
  evidence_completeness: "COMPLETE",
  reachability: "REACHABLE",
  exploitability: "HIGH",
  dependency_exposure: "UNKNOWN",
  affected_module_count: null,
  technical_risk: 87,
  risk_band: "CRITICAL",
  profile_snapshot: { id: "default", version: 1 },
  factors: { severity: 0.95, confidence: 0.9, reachability: 1 },
  calculation: { method: "deterministic-sample" },
  explanation: "The request parameter reaches a database query without parameterization in this demonstration finding.",
  assessed_at: createdAt,
};

export const sampleFindingDetails: Record<string, FindingDetail> = Object.fromEntries(
  sampleFindings.map(({ finding, occurrence }) => {
    const isSqlInjection = finding.id === "sample-sql-injection";
    const risks = isSqlInjection
      ? [riskAssessment]
      : [{
          ...riskAssessment,
          id: `${finding.id}-risk`,
          finding_id: finding.id,
          finding_occurrence_id: occurrence?.id ?? "",
          evidence_id: "",
          technical_risk: finding.currentRisk,
          risk_band: finding.currentSeverity,
          severity: finding.currentSeverity,
          confidence: finding.currentConfidence,
          evidence_authority: "INVESTIGATIVE",
          evidence_sufficiency: "UNKNOWN",
          evidence_completeness: "INCOMPLETE",
          explanation: "This demonstration finding has limited evidence.",
        }];
    return [finding.id, {
      finding,
      occurrence,
      evidence: isSqlInjection ? { snapshot: evidenceSnapshot, nodes: evidenceNodes, edges: evidenceEdges } : null,
      risks,
    }];
  }),
);

export const sampleHealthHistory: HealthHistoryEntry[] = [
  { snapshot: healthSnapshot, commitSha: sampleCommit.commitSha },
  {
    snapshot: { ...healthSnapshot, id: "sample-health-previous", overall_score: 79, security_score: 84, created_at: "2025-01-08T12:00:00.000Z" },
    commitSha: "demo000000000000000000000000000000000000",
  },
  {
    snapshot: { ...healthSnapshot, id: "sample-health-oldest", overall_score: 76, security_score: 80, created_at: "2025-01-01T12:00:00.000Z" },
    commitSha: "demo000000000000000000000000000000000000",
  },
];

export const sampleRepositoryHistory: RepositoryHistoryEntry[] = [{
  run: sampleRun,
  job: sampleJob,
  findingCount: sampleFindings.length,
  totalTechnicalRisk: sampleFindings.reduce((total, row) => total + row.finding.currentRisk, 0),
  healthScore: healthSnapshot.overall_score,
}];

export const sampleAnalysisStatus: AnalysisRunStatusResponse = {
  analysisRunId: sampleRunId,
  status: "COMPLETED",
  job: sampleJob,
  progress: { sourceFiles: 42, parsedFiles: 42, irEntityCount: 186, irRelationshipCount: 243, findings: 3 },
  failure: null,
  startedAt: createdAt,
  completedAt: createdAt,
};

export const sampleWorkspace = {
  repository: sampleRepository,
  codeLines: sampleCodeLines,
  overview: sampleOverview,
  findings: sampleFindings,
  findingDetails: sampleFindingDetails,
  healthHistory: sampleHealthHistory,
  repositoryHistory: sampleRepositoryHistory,
  analysisStatus: sampleAnalysisStatus,
};
