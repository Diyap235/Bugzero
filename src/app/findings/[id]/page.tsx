"use client";

import Link from "next/link";
import { useCallback } from "react";
import { useParams } from "next/navigation";
import { ArrowLeft, ArrowDown, FileCode2, GitCommitHorizontal, ShieldCheck } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { Metric, PageHeading, ResourceState, StatusLabel, formatTimestamp } from "@/components/product/ui";
import { useApiResource } from "@/hooks/useApiResource";
import { bugzeroApi } from "@/lib/api-client";
import { sampleFindingDetails } from "@/domains/product/sample-data";

export default function FindingDetailPage() {
  const params = useParams<{ id: string }>();
  const load = useCallback(() => bugzeroApi.getFinding(params.id), [params.id]);
  const sampleDetail = sampleFindingDetails[params.id] ?? sampleFindingDetails["sample-sql-injection"];
  const resource = useApiResource(load, sampleDetail);
  const detail = resource.data;
  const evidence = detail?.evidence;
  const latestRisk = detail?.risks[0] ?? null;
  const nodeById = new Map((evidence?.nodes ?? []).map((node) => [node.node_key, node]));
  const edgeById = new Map((evidence?.edges ?? []).map((edge) => [edge.edge_key, edge]));

  return (
    <AppShell>
      <div className="space-y-6">
        <Link href="/findings" className="inline-flex items-center gap-2 text-xs text-text-muted hover:text-white"><ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />Findings</Link>
        <ResourceState loading={resource.loading} error={resource.error} empty={!detail} retry={resource.refresh} sample={resource.isFallback} emptyTitle="Finding not found" />
        {detail && (!resource.error || resource.isFallback) && (
          <>
            <PageHeading
              eyebrow={`${detail.finding.ruleId} · ${detail.finding.lifecycle}`}
              title={detail.finding.ruleId.replaceAll(".", " ")}
              description="Finding metadata and deterministic evidence. No remediation or AI explanation is inferred."
              action={<div className="flex items-center gap-2"><StatusLabel value={detail.finding.currentSeverity} /><StatusLabel value={`${detail.finding.currentRisk} RISK`} /></div>}
            />
            <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Metric label="Rule" value={detail.finding.ruleId} />
              <Metric label="Confidence" value={detail.occurrence?.assessment.confidence ?? detail.finding.currentConfidence} />
              <Metric label="Lifecycle" value={detail.finding.lifecycle} />
              <Metric label="Repository" value={detail.finding.repositoryId} />
            </section>
            <section className="grid gap-3 rounded-xl border border-border bg-card p-4 sm:grid-cols-2 xl:grid-cols-4">
              <div><p className="text-[10px] uppercase text-text-muted">Commit</p><p className="mt-2 break-all font-mono text-xs text-white">{detail.occurrence?.commitSha ?? "Unknown"}</p></div>
              <div><p className="text-[10px] uppercase text-text-muted">Run</p><p className="mt-2 break-all font-mono text-xs text-white">{detail.occurrence?.analysisRunId ?? "Unknown"}</p></div>
              <div><p className="text-[10px] uppercase text-text-muted">Source location</p><p className="mt-2 break-all font-mono text-xs text-white">{detail.occurrence?.filePath ? `${detail.occurrence.filePath}${detail.occurrence.startLine ? `:${detail.occurrence.startLine}` : ""}` : "Unavailable"}</p></div>
              <div><p className="text-[10px] uppercase text-text-muted">Observed</p><p className="mt-2 text-xs text-white">{formatTimestamp(detail.occurrence?.createdAt)}</p></div>
            </section>

            <section className="rounded-xl border border-border bg-card">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
                <div><h2 className="flex items-center gap-2 text-sm font-semibold text-white"><ShieldCheck className="h-4 w-4 text-primary" aria-hidden="true" />Evidence graph</h2><p className="mt-1 text-xs text-text-muted">The displayed nodes and relationships are from the persisted snapshot.</p></div>
                {evidence ? <div className="flex flex-wrap gap-2"><StatusLabel value={evidence.snapshot.authority} /><StatusLabel value={evidence.snapshot.sufficiency} /><StatusLabel value={evidence.snapshot.completeness} /></div> : <StatusLabel value="NO EVIDENCE SNAPSHOT" />}
              </div>
              {!evidence ? <p className="px-4 py-8 text-sm text-text-muted">No evidence graph was returned for the current occurrence.</p> : (
                <div className="space-y-5 p-4">
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
