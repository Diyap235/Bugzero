export function getAnalysisActivityLabel(
  runStatus: string | null,
  jobStatus: string | null,
): "Analysis queued" | "Analysis running" {
  if (runStatus === "NOT_STARTED" || jobStatus === "QUEUED" || jobStatus === "RETRY") {
    return "Analysis queued";
  }
  return "Analysis running";
}
