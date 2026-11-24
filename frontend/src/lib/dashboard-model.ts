import type {
  ApiRepository,
  FindingRow,
  RepositoryHistoryEntry,
} from "@/domains/product/types";
import { sortNewestFirst } from "./analysis-order";

export interface DashboardRepositoryData {
  repository: ApiRepository;
  findings: FindingRow[];
  history: RepositoryHistoryEntry[];
}

export function summarizeDashboard(repositories: DashboardRepositoryData[]) {
  const findings = repositories.flatMap(({ findings: repositoryFindings }) => repositoryFindings);
  const securitySeverityCounts = {
    CRITICAL: 0,
    HIGH: 0,
    MEDIUM: 0,
    LOW: 0,
    INFO: 0,
  } satisfies Record<FindingRow["finding"]["currentSeverity"], number>;
  for (const { finding } of findings) {
    if (
      finding.ruleId.startsWith("SECURITY.")
      && !["RESOLVED", "DISMISSED"].includes(finding.lifecycle)
    ) {
      securitySeverityCounts[finding.currentSeverity] += 1;
    }
  }
  const recentActivity = sortNewestFirst(
    repositories.flatMap(({ repository, history }) =>
      history.map(({ run }) => ({ repository, run }))),
    ({ run }) => run.startedAt ?? run.createdAt,
  ).slice(0, 5);

  return {
    repositoryCount: repositories.length,
    analysisCount: repositories.reduce((total, { history }) => total + history.length, 0),
    findingCount: findings.length,
    resolvedFindingCount: findings.filter(({ finding }) => finding.lifecycle === "RESOLVED").length,
    securityFindingCount: Object.values(securitySeverityCounts).reduce((total, count) => total + count, 0),
    securitySeverityCounts,
    recentActivity,
  };
}

