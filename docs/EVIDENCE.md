# Evidence Graph

## Status

**IMPLEMENTED (bounded deterministic Structural/Quality and SQL-injection evidence; not live-DB verified).** Analyzer findings now persist immutable evidence snapshots through the existing PostgreSQL `evidence`, `evidence_nodes`, and `evidence_edges` tables. A snapshot is linked to its exact finding, finding occurrence, run, repository, and commit. Migration `0005_versioned_evidence_graph.sql` adds snapshot identity, explicit completeness/diagnostics, and source ranges; it extends the existing evidence model rather than introducing another one.

```text
Finding
  -> Evidence Snapshot (evidence row)
  -> Evidence Nodes
  -> Evidence Edges
  -> Ordered Evidence Paths
  -> Versioned Risk Assessment
  -> Repository Health Snapshot
```

An `evidence` row is the immutable per-finding-occurrence snapshot. It is not an independent mutable graph. Reanalysis at a later revision creates a new finding occurrence, snapshot, and linked risk assessment; prior evidence and assessments remain unchanged. Same-occurrence replays reuse the snapshot and profile-version assessment.

## Evidence facts, paths, snapshots, graph

- **Fact:** a deterministic assertion tied to persisted Code IR/source, such as a function's source span, its declared parameter edges, exact call edges, or a source-backed empty-body classification.
- **Path:** an ordered sequence of node keys and edge keys, with completeness and diagnostics. A one-node path represents a source-span fact without inventing a causal edge.
- **Snapshot:** the existing `evidence` row, bound by composite foreign keys to one finding occurrence and the corresponding run/repository/commit.
- **Graph:** snapshot-scoped nodes and edges. Existing composite primary/foreign keys keep children tenant- and snapshot-scoped.

`EvidencePathBuilder` traverses only `EXACT` relationships. It uses deterministic edge ordering, path-local cycle detection, and explicit `maxDepth`, `maxNodes`, `maxEdges`, `maxPaths`, and `maxDurationMs` bounds. Structural finding evidence uses direct, bounded paths; this is not a repository-wide causal/data-flow graph.

## Authority, provenance, confidence

- `AUTHORITATIVE` identifies evidence emitted by deterministic analysis over source-backed parser IR and exact repository-intelligence relationships.
- `INVESTIGATIVE` is reserved for unverified heuristic/AI evidence. No AI or heuristic producer is implemented.
- Snapshot `origin` uses the existing database enum `DETERMINISTIC_ANALYZER`. Node/edge attributes identify the narrower `CODE_IR`, `REPOSITORY_INTELLIGENCE`, or `STATIC_ANALYZER` provenance, with source provenance retained where available.
- Confidence remains distinct from authority. Exact parser/IR-backed facts use high confidence; relationship resolution is preserved on each edge. Unknown or inferred relationships are never rewritten as exact.

## Sufficiency and completeness

- `SUFFICIENT`: the snapshot completely represents the deterministic evidence for this candidate and has no known material uncertainty.
- `INSUFFICIENT`: known evidence is not enough to establish the result.
- `UNKNOWN`: the system cannot establish evidence sufficiency.
- `COMPLETE`: all intended snapshot evidence was captured.
- `PARTIAL`: some relevant information or a resource bound prevents completeness.
- `INCOMPLETE`: required target/evidence mapping is unavailable.

The SQL invariant disallows a non-complete snapshot from claiming `SUFFICIENT`. Missing IR targets create empty `INCOMPLETE` snapshots with `UNKNOWN` sufficiency. Unresolved relevant calls remain absent as edges and add uncertainty diagnostics; such a graph is `PARTIAL`/`UNKNOWN`.

## Structural finding evidence

| Finding | Persisted evidence |
|---|---|
| `LONG_FUNCTION` | Source-backed FUNCTION/METHOD node with exact file/start/end lines and measured inclusive line count/threshold fact; a one-node path. |
| `HIGH_PARAMETER_COUNT` | Function node plus every exact `DECLARES` edge and corresponding PARAMETER node; one ordered path per parameter. |
| `HIGH_FAN_OUT` | Function/class anchor plus every exact outgoing `CALLS` edge and target node; paths reproduce the counted call set. |
| `HIGH_FAN_IN` | Function/class anchor plus every exact incoming `CALLS` edge from caller nodes; paths reproduce the counted caller set. |
| `EMPTY_FUNCTION` | Function/method source span plus a `SOURCE` node classified `EMPTY_BODY`, joined by an exact analyzer-produced `CONTAINS` edge. Raw snippets are not persisted. |
| `SECURITY.SQL_INJECTION` | Exact external-input `SOURCE`, assignment/SQL-transformation/parameter/call/return propagation nodes as applicable, and recognized SQL `SINK`; the path must be complete and exact before a finding is emitted. Nodes and edges have `SECURITY_ANALYZER` provenance. |

Unsupported constructs and unresolved/dynamic/cross-file calls are not fabricated into edges.

SQL injection evidence is built from the deterministic security analyzer, not AI. It is marked `AUTHORITATIVE`, `SUFFICIENT`, and `COMPLETE` only when the supported source-to-sink path is proven. If a relevant relationship or construct is unresolved, the security analyzer reports PARTIAL/diagnostic status and does not invent an exact evidence path or emit a high-confidence vulnerability.

## Persistence, identity, and immutability

`EvidenceRepository.createGraph` writes snapshot, nodes, and edges in one PostgreSQL transaction. Snapshot identity is unique by `(organization_id, finding_occurrence_id, identity_fingerprint)`; node and edge identities use existing snapshot-scoped primary keys and `ON CONFLICT DO NOTHING`. Replays return the existing snapshot/graph. Different commit/run occurrences get separate snapshots. Existing database triggers reject evidence, node, edge, and occurrence mutation/deletion.

Tenant-scoped retrieval methods include `getSnapshot`, `getEvidenceForFinding`, `getNodesForFinding`, `getEdgesForFinding`, `getPath`, and `listForOccurrence`. Every query filters `organization_id`.

The bounded `EvidencePackage` contract is preparation only. There is no AI consumer, retrieval API, security taint producer, or evidence-based resolution flow in this v1 slice.

## Limits and known gaps

Defaults are `maxDepth=10`, `maxNodes=500`, `maxEdges=1000`, `maxPaths=100`, and `maxDurationMs=1000` per finding graph. Budget exhaustion preserves bounded evidence, records diagnostics/metrics, and marks the analyzer/run `PARTIAL`; it is not silently reported complete. Evidence node locations currently use line ranges; Code IR does not supply columns.

Python parsing is bounded and not a complete Python AST; JS/TS parser output and direct call resolution remain limited as described in [CODE_IR.md](CODE_IR.md). Only the SQL injection taint subset described in [SECURITY.md](SECURITY.md) is implemented. XSS, command injection, path traversal, SSRF, unsafe deserialization, secret/CVE analysis, AI generation, graph-database dependency, dynamic execution, and autonomous remediation are not included. No 1M-LOC scalability claim is included.

Apply migrations `0001` through `0007` in order with `psql -v ON_ERROR_STOP=1 -d "$DATABASE_URL" -f <migration>`. Migration 0006 stores linked immutable risk assessments; migration 0007 extends the existing immutable health snapshots. Live PostgreSQL migration/constraint execution was unavailable; tests validate migration definitions and exercise the worker graph path with injected memory repositories. See [RISK.md](RISK.md) and [HEALTH.md](HEALTH.md) for downstream aggregation boundaries.
