"use client";

import Link from "next/link";
import { useCallback } from "react";
import { useParams } from "next/navigation";
import { ArrowLeft, ArrowDown, FileCode2, GitCommitHorizontal, ShieldCheck, Sparkles } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { Metric, PageHeading, ResourceState, StatusLabel, formatTimestamp } from "@/components/product/ui";
import { useApiResource } from "@/hooks/useApiResource";
import { bugzeroApi } from "@/lib/api-client";

export default function FindingDetailPage() {
  const params = useParams<{ id: string }>();
  const load = useCallback(() => bugzeroApi.getFinding(params.id), [params.id]);
  const resource = useApiResource(load);
  const detail = resource.data;
  const evidence = detail?.evidence;
  const latestRisk = detail?.risk ?? detail?.risks[0] ?? null;
  const aiInvestigation = detail?.aiInvestigations[0] ?? null;
  const aiExplanation = detail?.aiExplanation;
  const recommendedFix = detail?.recommendedFix ?? aiInvestigation?.result?.remediation ?? null;
  const aiRunStatus = detail?.aiInvestigationStatus ?? null;
  const nodeById = new Map((evidence?.nodes ?? []).map((node) => [node.node_key, node]));
  const edgeById = new Map((evidence?.edges ?? []).map((edge) => [edge.edge_key, edge]));

  return (
    <AppShell>
      <div className="space-y-6">
        <Link href="/findings" className="inline-flex items-center gap-2 text-xs text-text-muted hover:text-white"><ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />Findings</Link>
        <ResourceState loading={resource.loading} error={resource.error} empty={!detail} retry={resource.refresh} emptyTitle="Finding not found" />
        {detail && !resource.error && (
          <>
            <PageHeading
              eyebrow={`${detail.finding.ruleId} · ${detail.finding.lifecycle}`}
              title={detail.title ?? detail.finding.ruleId.replaceAll(".", " ")}
              description="Deterministic analysis establishes findings. ML prioritizes investigation; AI explains persisted evidence. Neither changes finding authority or risk."
              action={<div className="flex flex-wrap items-center gap-2"><StatusLabel value={detail.finding.currentSeverity} /><StatusLabel value={detail.occurrence?.assessment.confidence ?? detail.finding.currentConfidence} /><StatusLabel value={detail.finding.lifecycle} /></div>}
            />
            <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Metric label="Rule / category" value={detail.finding.ruleId} />
              <Metric label="Confidence" value={detail.occurrence?.assessment.confidence ?? detail.finding.currentConfidence} />
              <Metric label="Status" value={detail.finding.lifecycle} />
              <Metric label="Location" value={detail.location?.filePath ? `${detail.location.filePath}${detail.location.startLine ? `:${detail.location.startLine}` : ""}` : "Unavailable"} />
            </section>
            <section className="grid gap-3 rounded-xl border border-border bg-card p-4 sm:grid-cols-2 xl:grid-cols-4">
              <div><p className="text-[10px] uppercase text-text-muted">Commit</p><p className="mt-2 break-all font-mono text-xs text-white">{detail.occurrence?.commitSha ?? "Unknown"}</p></div>
              <div><p className="text-[10px] uppercase text-text-muted">Run</p><p className="mt-2 break-all font-mono text-xs text-white">{detail.occurrence?.analysisRunId ?? "Unknown"}</p></div>
              <div><p className="text-[10px] uppercase text-text-muted">Source location</p><p className="mt-2 break-all font-mono text-xs text-white">{detail.occurrence?.filePath ? `${detail.occurrence.filePath}${detail.occurrence.startLine ? `:${detail.occurrence.startLine}` : ""}` : "Unavailable"}</p></div>
              <div><p className="text-[10px] uppercase text-text-muted">Observed</p><p className="mt-2 text-xs text-white">{formatTimestamp(detail.occurrence?.createdAt)}</p></div>
            </section>
            {detail.description && <p className="text-[11px] text-text-muted">Deterministic observation: <span className="font-mono text-text-secondary">{detail.description}</span></p>}

            <section className="rounded-xl border border-border bg-card">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
                <div><h2 className="flex items-center gap-2 text-sm font-semibold text-white"><ShieldCheck className="h-4 w-4 text-primary" aria-hidden="true" />Why BugZero found this</h2><p className="mt-1 text-xs text-text-muted">Deterministic proof from the persisted evidence graph—not an AI-generated explanation.</p></div>
                {evidence ? <div className="flex flex-wrap gap-2"><StatusLabel value={evidence.snapshot.authority} /><StatusLabel value={evidence.snapshot.sufficiency} /><StatusLabel value={evidence.snapshot.completeness} /></div> : <StatusLabel value="NO EVIDENCE SNAPSHOT" />}
              </div>
              {!evidence ? <p className="px-4 py-8 text-sm text-text-muted">No deterministic evidence graph is available for the current occurrence.</p> : (
                <div className="space-y-5 p-4">
                  <p className="text-xs leading-5 text-emerald-200">Deterministic analysis established this finding. Evidence authority, completeness, and sufficiency below are the persisted values.</p>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Metric label="Provenance" value={evidence.snapshot.origin} />
                    <Metric label="Evidence nodes" value={evidence.nodes.length} />
                    <Metric label="Evidence edges" value={evidence.edges.length} />
                  </div>
                  {!evidence.snapshot.complete && <div className="rounded-lg border border-amber-800/60 bg-amber-950/20 p-3 text-xs text-amber-100">This evidence is incomplete. Do not interpret the displayed path as a fully resolved proof.</div>}
                  {evidence.snapshot.diagnostics.length > 0 && <ul className="list-inside list-disc space-y-1 text-xs text-amber-200">{evidence.snapshot.diagnostics.map((diagnostic, index) => <li key={`${index}-${diagnostic}`}>{diagnostic}</li>)}</ul>}
                  {evidence.snapshot.paths.length === 0 ? <p className="text-xs text-text-muted">The snapshot contains no persisted path.</p> : evidence.snapshot.paths.map((path) => (
                    <section key={path.id} className="rounded-lg border border-border p-3">
                      <div className="mb-3 flex items-center justify-between gap-3"><p className="font-mono text-[10px] text-text-muted">Path {path.id}</p><StatusLabel value={path.completeness} /></div>
                      <ol className="space-y-2">
                        {path.nodeIds.map((nodeId, index) => {
                          const node = nodeById.get(nodeId);
                          const edge = path.edgeIds[index] ? edgeById.get(path.edgeIds[index] ?? "") : undefined;
                          return (
                            <li key={`${path.id}-${nodeId}-${index}`}>
                              {node ? (
                                <div className="flex min-w-0 items-start gap-3 rounded-lg bg-background p-3">
                                  <FileCode2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                                  <div className="min-w-0 flex-1">
                                    <p className="break-words text-xs font-semibold text-white">{node.label}</p>
                                    <p className="mt-1 break-all font-mono text-[10px] text-text-muted">{node.node_type} · {node.file_path ?? "No file location"}{node.line ? `:${node.line}` : ""}</p>
                                    <p className="mt-1 text-[10px] text-text-muted">Resolution {String(node.attributes.resolution ?? "not provided")} · Provenance {String(node.attributes.provenance ?? evidence.snapshot.origin)}</p>
                                  </div>
                                </div>
                              ) : <p className="rounded border border-amber-800/60 p-3 text-xs text-amber-200">Path references a node not included in the returned graph: {nodeId}</p>}
                              {edge && <div className="flex items-center gap-2 py-1 pl-7 text-[10px] text-text-muted"><ArrowDown className="h-3 w-3" aria-hidden="true" /><span className="font-mono">{edge.relation}</span><span>· {edge.resolution}</span><span>· confidence {edge.confidence}</span></div>}
                            </li>
                          );
                        })}
                      </ol>
                      {path.diagnostics.length > 0 && <p className="mt-3 text-xs text-amber-200">{path.diagnostics.join(" · ")}</p>}
                    </section>
                  ))}
                </div>
              )}
            </section>

            <section className="rounded-xl border border-border bg-card">
              <div className="border-b border-border px-4 py-3"><h2 className="text-sm font-semibold text-white">Deterministic risk assessment</h2><p className="mt-1 text-xs text-text-muted">Severity, confidence, evidence, and technical risk remain separate dimensions.</p></div>
              {!latestRisk ? <p className="px-4 py-8 text-sm text-text-muted">No persisted risk assessment is available for the current occurrence.</p> : (
                <div className="space-y-4 p-4">
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <Metric label="Technical risk" value={`${latestRisk.technical_risk}`} tone={latestRisk.risk_band === "CRITICAL" || latestRisk.risk_band === "HIGH" ? "danger" : "neutral"} />
                    <Metric label="Risk band" value={latestRisk.risk_band} />
                    <Metric label="Profile" value={`${latestRisk.profile_id} v${latestRisk.profile_version}`} />
                    <Metric label="Model version" value={latestRisk.model_version} />
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                    {["severity", "confidence", "evidence_strength", "evidence_authority", "evidence_sufficiency", "evidence_completeness", "reachability", "exploitability", "dependency_exposure"].map((key) => (
                      <div key={key} className="flex items-center justify-between gap-3 border-t border-border pt-2"><span className="text-[10px] capitalize text-text-muted">{key.replaceAll("_", " ")}</span><StatusLabel value={String(latestRisk[key as keyof typeof latestRisk] ?? "UNKNOWN")} /></div>
                    ))}
                  </div>
                  <p className="text-xs leading-5 text-text-secondary">{latestRisk.explanation}</p>
                  <details className="rounded-lg border border-border p-3"><summary className="cursor-pointer text-xs text-text-secondary">Risk factors and calculation</summary><pre className="mt-3 overflow-x-auto text-[10px] leading-5 text-text-muted">{JSON.stringify({ factors: latestRisk.factors, calculation: latestRisk.calculation }, null, 2)}</pre></details>
                  {detail.risks.length > 1 && <p className="inline-flex items-center gap-1 text-[10px] text-text-muted"><GitCommitHorizontal className="h-3.5 w-3.5" aria-hidden="true" />{detail.risks.length} assessments exist for this occurrence and profile history.</p>}
                </div>
              )}
            </section>

            <section className="rounded-xl border border-amber-800/50 bg-[#100f0b]">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-amber-900/50 px-4 py-3">
                <div><h2 className="text-sm font-semibold text-white">ML signal</h2><p className="mt-1 text-xs text-text-muted">Separate model output; it is not proof and cannot change deterministic records.</p></div>
                <span className="rounded border border-amber-700/60 px-2 py-1 font-mono text-[10px] uppercase tracking-wide text-amber-200">Investigative signal</span>
              </div>
              {!detail.mlSignal ? (
                <p className="px-4 py-5 text-sm text-text-muted">
                  {detail.mlSignalStatus === "UNAVAILABLE"
                    ? "ML inference was unavailable. Deterministic finding, evidence, and risk remain unchanged."
                    : detail.mlSignalStatus === "AVAILABLE"
                      ? "ML ran for this analysis, but no signal matches this finding location."
                      : detail.mlSignalStatus === "NOT_APPLICABLE"
                        ? "ML inference was not applicable to this analysis scope. The current ML adapter scores Python functions and methods only."
                        : "ML status was not reported for this analysis. No investigative signal is available."}
                </p>
              ) : (
                <div className="grid gap-4 p-4 sm:grid-cols-[1fr_auto] sm:items-center">
                  <div>
                    <div className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-amber-300" aria-hidden="true" /><p className="text-xs font-semibold text-white">BugZero ML {detail.mlSignal.modelVersion}</p></div>
                    <p className="mt-2 font-mono text-xs uppercase text-amber-100">Prediction: {detail.mlSignal.label}</p>
                    <p className="mt-1 text-[10px] text-text-muted">{detail.mlSignal.function.functionName ?? "Python function"} · {detail.mlSignal.function.filePath}:{detail.mlSignal.function.startLine}-{detail.mlSignal.function.endLine}</p>
                  </div>
                  <Metric label="Vulnerability probability" value={`${(detail.mlSignal.score * 100).toFixed(2)}%`} />
                  <p className="text-xs leading-5 text-text-muted sm:col-span-2">ML signals help prioritize investigation but do not establish authoritative findings.</p>
                </div>
              )}
            </section>

            <section className="rounded-xl border border-border bg-card">
              <div className="border-b border-border px-4 py-3">
                <h2 className="text-sm font-semibold text-white">AI investigation</h2>
                <p className="mt-1 text-xs text-text-muted">Optional Groq-generated explanation based only on this finding’s bounded evidence. It does not confirm findings or change evidence and risk.</p>
              </div>
              {!aiInvestigation && !aiExplanation ? (
                <div className="space-y-2 px-4 py-5">
                  {aiRunStatus && <StatusLabel value={aiRunStatus} />}
                  <p className="text-sm text-text-muted">
                    {aiRunStatus === "UNAVAILABLE"
                      ? "AI investigation was unavailable for this analysis. Deterministic finding, evidence, and risk remain unchanged."
                      : aiRunStatus === "NOT_REQUESTED"
                        ? "AI investigation was not requested for this analysis."
                        : aiRunStatus === "FAILED"
                          ? "AI investigation failed for this analysis. Deterministic finding, evidence, and risk remain unchanged."
                          : aiRunStatus === "PARTIAL"
                            ? "AI investigation completed for only part of this analysis; no explanation is stored for this finding."
                            : aiRunStatus === "COMPLETED"
                              ? "The analysis reports AI investigation activity, but no explanation is stored for this finding."
                              : "No AI investigation result or run-level AI status was returned for this evidence snapshot."}
                  </p>
                </div>
              ) : (aiExplanation?.status ?? aiInvestigation?.status) === "PENDING" ? (
                <p className="px-4 py-5 text-sm text-text-muted">AI investigation is pending. Deterministic analysis results are unaffected.</p>
              ) : (aiExplanation?.status ?? aiInvestigation?.status) === "FAILED" || (!aiExplanation?.explanation && !aiInvestigation?.result) ? (
                <p className="px-4 py-5 text-sm text-text-muted">AI investigation is unavailable. Deterministic finding, evidence, and risk remain unchanged.</p>
              ) : (
                <div className="space-y-4 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusLabel value={(aiExplanation?.reasoningStatus ?? aiInvestigation?.result?.reasoningStatus) === "SUPPORTED" ? "EXPLANATORY ONLY" : (aiExplanation?.reasoningStatus ?? aiInvestigation?.result?.reasoningStatus)} />
                    {aiInvestigation?.result?.confidence && <span className="text-[10px] text-text-muted">AI confidence: {aiInvestigation.result.confidence}</span>}
                  </div>
                  <div>
                    <h3 className="text-xs font-semibold text-white">{aiExplanation?.summary ?? aiInvestigation?.result?.summary}</h3>
                    <p className="mt-2 text-xs leading-5 text-text-secondary">{aiExplanation?.explanation ?? aiInvestigation?.result?.explanation}</p>
                  </div>
                  {Boolean((aiExplanation?.attackPath ?? aiInvestigation?.result?.attackPath ?? []).length) && (
                    <div>
                      <h3 className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">AI-described attack scenario</h3>
                      <ol className="mt-2 list-inside list-decimal space-y-1 text-xs leading-5 text-text-secondary">
                        {(aiExplanation?.attackPath ?? aiInvestigation?.result?.attackPath ?? []).map((step, index) => <li key={`${index}-${step}`}>{step}</li>)}
                      </ol>
                    </div>
                  )}
                  <p className="text-[10px] text-text-muted">Groq · {aiExplanation?.model ?? aiInvestigation?.model} · {aiInvestigation?.promptVersion ?? "stored investigation"}. Explanatory only; not evidence.</p>
                </div>
              )}
            </section>
            <section className="rounded-xl border border-border bg-card">
              <div className="border-b border-border px-4 py-3"><h2 className="text-sm font-semibold text-white">Recommended fix</h2><p className="mt-1 text-xs text-text-muted">Remediation returned by the stored AI investigation; never generated by the UI.</p></div>
              {recommendedFix?.length ? (
                <ul className="space-y-2 p-4 text-xs leading-5 text-text-secondary">
                  {recommendedFix.map((item, index) => <li key={`${index}-${item}`} className="flex gap-2"><span className="font-mono text-primary">{String(index + 1).padStart(2, "0")}</span><span>{item}</span></li>)}
                </ul>
              ) : <p className="px-4 py-5 text-sm text-text-muted">No stored AI remediation is available. No fix has been inferred or hardcoded.</p>}
            </section>
            <section className="rounded-xl border border-border bg-card p-4">
              <h2 className="text-sm font-semibold text-white">Source code</h2>
              <p className="mt-2 text-xs leading-5 text-text-muted">A source snippet is not included with this finding. The recorded occurrence location is the available source reference.</p>
            </section>
          </>
        )}
      </div>
    </AppShell>
  );
}
