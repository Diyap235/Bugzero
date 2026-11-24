import assert from "node:assert/strict";
import { test } from "node:test";
import type { ApiReportDocument } from "../src/domains/product/types";
import { reportFindingsCsv, reportPdfBlob } from "../src/lib/report-export";

const report: ApiReportDocument = {
  id: "11111111-1111-4111-8111-111111111111",
  repository: {
    id: "22222222-2222-4222-8222-222222222222",
    name: "acme/example",
  },
  analysis: {
    runId: "33333333-3333-4333-8333-333333333333",
    status: "PARTIAL",
    scope: "COMMIT",
    commitSha: "a".repeat(40),
    createdAt: "2025-01-02T03:04:05.000Z",
    completedAt: null,
    coverage: { inspectedFiles: 4 },
  },
  executiveSummary: "One persisted security finding.",
  findings: {
    total: 1,
    bySeverity: { INFO: 0, LOW: 0, MEDIUM: 0, HIGH: 1, CRITICAL: 0 },
    security: [{
      findingId: "44444444-4444-4444-8444-444444444444",
      ruleId: "SECURITY.SQL_INJECTION",
      title: "SQL Injection",
      description: null,
      severity: "HIGH",
      confidence: "HIGH",
      lifecycle: "OPEN",
      filePath: "src/unsafe.ts",
      startLine: 12,
      endLine: 14,
      evidenceAuthority: "AUTHORITATIVE",
      evidenceStatus: "COMPLETE",
      evidence: ["Untrusted input reaches a dynamic SQL sink."],
      investigativeEstimate: null,
    }],
    codeQuality: [],
  },
  results: {
    quality: { status: "PARTIAL", score: 72 },
    maintainability: { status: "UNKNOWN", score: null },
    reliability: { status: "UNKNOWN", score: null },
    dependencies: { status: "UNKNOWN", score: null },
    coverage: { status: "PARTIAL", details: { inspectedFiles: 4 } },
  },
  recommendations: [{
    text: "Use parameterized queries.",
    basis: "SECURITY.SQL_INJECTION",
    authority: "AUTHORITATIVE",
  }],
  evidencePolicy: {
    authoritative: "Deterministic evidence is authoritative.",
    investigative: "AI context is advisory only.",
  },
};

test("CSV export includes the preview findings and explicit unknown descriptions", () => {
  const csv = reportFindingsCsv(report);
  assert.match(csv, /"findingId","category","ruleId"/);
  assert.match(csv, /"SQL Injection","Unknown — no persisted finding description","HIGH"/);
  assert.match(csv, /"AUTHORITATIVE","COMPLETE"/);
  assert.equal(csv.split("\r\n").length, 2);
});

test("PDF export creates a multipurpose readable PDF from the report document", async () => {
  const blob = reportPdfBlob(report);
  assert.equal(blob.type, "application/pdf");
  const contents = await blob.text();
  assert.ok(contents.startsWith("%PDF-1.4"));
  assert.match(contents, /xref/);
  assert.match(contents, /startxref/);
  const xrefOffset = Number(contents.match(/startxref\n(\d+)/)?.[1]);
  assert.equal(contents.slice(xrefOffset, xrefOffset + 4), "xref");
  assert.match(contents, /SQL Injection/);
  assert.match(contents, /Untrusted input reaches a dynamic SQL sink/);
  assert.match(contents, /Unknown/);
});

test("empty findings export contains the CSV header and no fabricated rows", () => {
  const emptyReport = {
    ...report,
    findings: {
      ...report.findings,
      total: 0,
      security: [],
      codeQuality: [],
    },
  };
  const csv = reportFindingsCsv(emptyReport);
  assert.equal(csv.split("\r\n").length, 1);
  assert.match(csv, /"findingId","category","ruleId"/);
});
