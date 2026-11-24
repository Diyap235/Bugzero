import type { ApiReportDocument } from "@/domains/product/types";

function findings(report: ApiReportDocument) {
  return [...report.findings.security, ...report.findings.codeQuality];
}

function csvCell(value: string | number | null): string {
  const text = value === null ? "" : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

export function reportFindingsCsv(report: ApiReportDocument): string {
  const columns = [
    "findingId", "category", "ruleId", "title", "description", "severity", "confidence",
    "lifecycle", "filePath", "startLine", "endLine", "evidenceAuthority", "evidenceStatus",
    "evidence", "investigativeEstimate", "investigativeConfidence", "investigativeReasoningStatus",
  ];
  const rows = findings(report).map((finding) => [
    finding.findingId,
    finding.ruleId.startsWith("SECURITY.") ? "Security" : "Code quality",
    finding.ruleId,
    finding.title,
    finding.description ?? "Unknown — no persisted finding description",
    finding.severity,
    finding.confidence,
    finding.lifecycle,
    finding.filePath,
    finding.startLine,
    finding.endLine,
    finding.evidenceAuthority,
    finding.evidenceStatus,
    finding.evidence.join(" | "),
    finding.investigativeEstimate
      ? `${finding.investigativeEstimate.summary} — ${finding.investigativeEstimate.explanation}`
      : null,
    finding.investigativeEstimate?.confidence ?? null,
    finding.investigativeEstimate?.reasoningStatus ?? null,
  ].map(csvCell).join(","));
  return [columns.map(csvCell).join(","), ...rows].join("\r\n");
}

function reportLines(report: ApiReportDocument): string[] {
  const lines = [
    `BugZero Report — ${report.repository.name}`,
    `Analysis timestamp: ${report.analysis.completedAt ?? report.analysis.createdAt}`,
    `Analysis status: ${report.analysis.status}; scope: ${report.analysis.scope}`,
    `Commit: ${report.analysis.commitSha ?? "Unknown"}`,
    "",
    "EXECUTIVE SUMMARY",
    report.executiveSummary,
    "",
    "FINDING COUNTS BY SEVERITY",
    ...Object.entries(report.findings.bySeverity).map(([severity, count]) => `${severity}: ${count}`),
    "",
    "CODE QUALITY / MAINTAINABILITY / RELIABILITY / DEPENDENCIES",
    ...Object.entries(report.results).filter(([key]) => key !== "coverage").map(([key, result]) => {
      const value = result as { status: string; score: number | null };
      return `${key}: ${value.score === null ? "Unknown" : value.score} (${value.status})`;
    }),
    `Coverage: ${report.results.coverage.status}`,
    "",
    "SECURITY FINDINGS",
  ];
  for (const finding of report.findings.security) {
    lines.push(
      `${finding.severity} — ${finding.title} (${finding.ruleId})`,
      `Confidence: ${finding.confidence}; lifecycle: ${finding.lifecycle}`,
      `Description: ${finding.description ?? "Unknown — no persisted finding description"}`,
      `Location: ${finding.filePath ?? "Unknown"}${finding.startLine ? `:${finding.startLine}` : ""}${finding.endLine && finding.endLine !== finding.startLine ? `-${finding.endLine}` : ""}`,
      `Evidence: ${finding.evidenceAuthority}; ${finding.evidenceStatus}`,
      ...finding.evidence.map((entry) => `  - ${entry}`),
    );
    if (finding.investigativeEstimate) {
      lines.push(
        `AI investigative estimate (${finding.investigativeEstimate.confidence}; ${finding.investigativeEstimate.reasoningStatus}): ${finding.investigativeEstimate.summary}`,
        finding.investigativeEstimate.explanation,
      );
    }
    lines.push("");
  }
  lines.push("CODE QUALITY FINDINGS");
  for (const finding of report.findings.codeQuality) {
    lines.push(
      `${finding.severity} — ${finding.title} (${finding.ruleId})`,
      `Confidence: ${finding.confidence}; lifecycle: ${finding.lifecycle}`,
      `Description: ${finding.description ?? "Unknown — no persisted finding description"}`,
      `Location: ${finding.filePath ?? "Unknown"}${finding.startLine ? `:${finding.startLine}` : ""}${finding.endLine && finding.endLine !== finding.startLine ? `-${finding.endLine}` : ""}`,
      `Evidence: ${finding.evidenceAuthority}; ${finding.evidenceStatus}`,
      ...finding.evidence.map((entry) => `  - ${entry}`),
      "",
    );
  }
  lines.push("RECOMMENDATIONS", ...report.recommendations.map(({ text, basis, authority }) =>
    `- ${text} [${authority}; ${basis}]`), "", "EVIDENCE POLICY",
    report.evidencePolicy.authoritative, report.evidencePolicy.investigative);
  return lines.flatMap((line) => {
    if (line.length <= 92) return [line];
    const wrapped: string[] = [];
    for (let start = 0; start < line.length; start += 92) wrapped.push(line.slice(start, start + 92));
    return wrapped;
  });
}

function pdfLiteral(value: string): string {
  return value.replace(/[^\x20-\x7e]/g, "?").replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
}

export function reportPdfBlob(report: ApiReportDocument): Blob {
  const lines = reportLines(report);
  const pages: string[][] = [];
  for (let index = 0; index < lines.length; index += 48) pages.push(lines.slice(index, index + 48));
  if (pages.length === 0) pages.push(["BugZero report"]);

  const objects: string[] = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${pages.map((_, index) => `${4 + index * 2} 0 R`).join(" ")}] /Count ${pages.length} >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  pages.forEach((page) => {
    const content = [
      "BT",
      "/F1 9 Tf",
      "48 744 Td",
      "12 TL",
      ...page.flatMap((line, index) => index === 0
        ? [`(${pdfLiteral(line)}) Tj`]
        : ["T*", `(${pdfLiteral(line)}) Tj`]),
      "ET",
    ].join("\n");
    const pageId = objects.length + 1;
    const contentId = pageId + 1;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`,
      `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    );
  });

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return new Blob([pdf], { type: "application/pdf" });
}
