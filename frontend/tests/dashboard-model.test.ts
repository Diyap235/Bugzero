import assert from "node:assert/strict";
import test from "node:test";
import type { ApiRepository, ApiRun, FindingRow, RepositoryHistoryEntry } from "../src/domains/product/types";
import { summarizeDashboard } from "../src/lib/dashboard-model";

function repository(id: string): ApiRepository {
  return {
    id,
    organizationId: "11111111-1111-4111-8111-111111111111",
    provider: "LOCAL",
    externalId: id,
    fullName: `workspace/${id}`,
    defaultBranch: "main",
    cloneUrl: "",
    createdAt: "2026-11-21T00:00:00.000Z",
    updatedAt: "2026-11-21T00:00:00.000Z",
  };
}

function finding(
  id: string,
  lifecycle: FindingRow["finding"]["lifecycle"],
  ruleId = "QUALITY.EMPTY_FUNCTION",
  currentSeverity: FindingRow["finding"]["currentSeverity"] = "MEDIUM",
): FindingRow {
  return {
    finding: {
      id,
      organizationId: "11111111-1111-4111-8111-111111111111",
      repositoryId: "repository",
      ruleId,
      lifecycle,
      currentOccurrenceId: null,
      resolutionEvidenceId: null,
      currentSeverity,
      currentConfidence: "HIGH",
      currentRisk: null,
      lastSeenRevision: null,
      humanDisposition: {
        businessPriority: null,
        acceptedRisk: false,
        exceptionId: null,
        dispositionReason: null,
      },
      createdAt: "2026-11-21T00:00:00.000Z",
      updatedAt: "2026-11-21T00:00:00.000Z",
    },
    occurrence: null,
  };
}

function history(id: string, createdAt: string): RepositoryHistoryEntry {
  const run: ApiRun = {
    id,
    organizationId: "11111111-1111-4111-8111-111111111111",
    repositoryId: "repository",
    commitId: `commit-${id}`,
    commitSha: null,
    profileId: "default",
    profileVersion: "1",
    scope: "COMMIT",
    status: "COMPLETED",
    createdAt,
    startedAt: null,
    completedAt: createdAt,
    coverage: {},
  };
  return { run, job: null, findingCount: 0, totalTechnicalRisk: 0, healthScore: null };
}

test("empty workspaces summarize to zero counts with no recent activity", () => {
  assert.deepEqual(summarizeDashboard([]), {
    repositoryCount: 0,
    analysisCount: 0,
    findingCount: 0,
    resolvedFindingCount: 0,
    securityFindingCount: 0,
    securitySeverityCounts: {
      CRITICAL: 0,
      HIGH: 0,
      MEDIUM: 0,
      LOW: 0,
      INFO: 0,
    },
    recentActivity: [],
  });
});

test("dashboard counts persisted findings and analyses and orders actual activity newest first", () => {
  const firstRepository = repository("first");
  const secondRepository = repository("second");
  const summary = summarizeDashboard([
    {
      repository: firstRepository,
      findings: [
        finding("open", "OPEN"),
        finding("resolved", "RESOLVED", "SECURITY.SQL_INJECTION", "CRITICAL"),
        finding("security-high", "IN_PROGRESS", "SECURITY.SQL_INJECTION", "HIGH"),
        finding("dismissed", "DISMISSED", "SECURITY.SQL_INJECTION", "LOW"),
      ],
      history: [
        history("older", "2026-11-19T00:00:00.000Z"),
        history("newest", "2026-11-21T00:00:00.000Z"),
      ],
    },
    {
      repository: secondRepository,
      findings: [finding("dismissed-quality", "DISMISSED")],
      history: [history("middle", "2026-11-20T00:00:00.000Z")],
    },
  ]);

  assert.equal(summary.repositoryCount, 2);
  assert.equal(summary.analysisCount, 3);
  assert.equal(summary.findingCount, 5);
  assert.equal(summary.resolvedFindingCount, 1);
  assert.equal(summary.securityFindingCount, 1);
  assert.deepEqual(summary.securitySeverityCounts, {
    CRITICAL: 0,
    HIGH: 1,
    MEDIUM: 0,
    LOW: 0,
    INFO: 0,
  });
  assert.deepEqual(summary.recentActivity.map(({ run }) => run.id), ["newest", "middle", "older"]);
  assert.equal(summary.recentActivity[0]?.repository.id, firstRepository.id);
  assert.equal(summary.recentActivity[1]?.repository.id, secondRepository.id);
});
