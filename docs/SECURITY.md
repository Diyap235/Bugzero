# Security analysis

## Status

**PARTIAL — deterministic SQL injection detection is implemented as `SECURITY.SQL_INJECTION` v1.0.0.** Other security families remain planned. This is a conservative static-analysis slice, not a general security audit or a framework-independent guarantee.

The security analyzer runs inside the existing worker `AnalyzerOrchestrator`. It uses scoped Code IR entities and exact Repository Intelligence `CALLS` relationships for same-file calls. For JavaScript/TypeScript it also resolves unambiguous named/default relative imports to exported functions in the already-loaded repository snapshot; these analyzer-local call links are not persisted as Code IR relationships. Source expressions and SQL construction are refined from source syntax using the existing TypeScript AST parser for JavaScript/TypeScript and a narrow explicit Python statement subset. No repository code is executed.

```text
Code IR + Repository Intelligence
  -> explicit source match
  -> bounded taint propagation
  -> recognized parameterization boundary
  -> explicit SQL sink match
  -> SECURITY.SQL_INJECTION candidate
  -> existing Finding / FindingOccurrence repositories
  -> authoritative occurrence-linked evidence graph
```

The analyzer, not AI, produces the finding. An optional post-analysis Groq investigator may provide an advisory explanation for an already-persisted finding; it cannot create findings or alter deterministic evidence, risk, or run status. No autonomous remediation or runtime/sandbox execution is implemented.

## Optional AI investigation

The worker can be configured with server-side `GROQ_API_KEY` and `GROQ_MODEL`. No key is needed for deterministic analysis, and the key must not be exposed through a `NEXT_PUBLIC_*` variable. AI requests are limited to persisted finding/evidence context and nearby source snippets; the whole repository is never submitted. Context size, source excerpts, graph elements, paths, output tokens, timeout, and retries are bounded. Selected credential assignments, bearer tokens, private-key blocks, and sensitive file paths receive best-effort redaction/exclusion; this is not a general secret-scanning guarantee.

Groq output is accepted only as a strict structured explanation. Incomplete analysis or evidence forces `INSUFFICIENT_EVIDENCE`; provider/configuration errors are stored as safe statuses and do not change deterministic analysis status. The result is associated with its occurrence and evidence snapshot and is idempotently reused on replay. Finding-detail readback exposes validated structured fields, not prompt/context or provider error text. See [ADR-007](adr/ADR-007-ai-boundary.md).

## Implemented rule

| Rule | Severity | Decision |
|---|---|---|
| `SECURITY.SQL_INJECTION` | HIGH | Emit only when an exact supported untrusted source reaches a recognized SQL-shaped dynamic query at a recognized sink through a complete exact path, without recognized parameter binding. Otherwise do not emit a vulnerability finding; unresolved or unsupported relevant flow is diagnostic/PARTIAL. |

Confidence is deterministic: `HIGH` only for an exact source and sink joined by a complete exact propagation path. No numeric or LLM-generated confidence score is used.

## Verified source patterns

- **JavaScript/TypeScript:** `req.query.<property>`, `req.body.<property>`, `req.params.<property>` and the corresponding `request.*` forms, where `req`/`request` is a function parameter. Bracket access such as `req.query["id"]` is supported. Aliasing an identified input value through simple assignments is supported.
- **Python:** direct assignment from `req`/`request` subscripts such as `request.args["id"]`, `request.form["name"]`, and `request.json["field"]` (also `query`, `body`, and `params` properties in the same explicit subscript form).

This list is intentionally explicit. Framework-specific wrappers, aliases not represented by the supported flow, arbitrary source-code substring matches, and request APIs outside these patterns are not treated as proven sources.

## Verified SQL sinks

Only direct calls with the following receiver/method combinations are recognized:

- `db.query` / `db.execute`
- `database.query` / `database.execute`
- `connection.query` / `connection.execute`
- `conn.query` / `conn.execute`
- `cursor.execute`

The same fixed receiver list is used for the supported Python statement subset. A free-standing `query(...)`, an arbitrary object method named `execute`, or a guessed external function is not a sink.

## Safe parameterization boundary

- **JavaScript/TypeScript:** a static SQL literal with a recognized placeholder (`?`, `%...`, `$1`, or `:name`) and a separate non-empty bindings argument is a safe parameterized-query shape.
- **Python:** a recognized static SQL literal with a placeholder and a separate bound-values argument in a supported `execute`/`query` call is a safe shape.

The analyzer does not recognize generic calls named `escape`, `sanitize`, or `clean` as safe. A dynamic SQL string remains dynamic even if another argument is also passed.

## Data-flow boundary

- **JavaScript/TypeScript:** supports direct assignments and aliases, string concatenation, template interpolation, exact same-file calls present in Code IR/Repository Intelligence, and unambiguous named/default relative imports to exported functions in the loaded snapshot. Supported relative resolution includes extensionless, `.ts`, `.tsx`, `.js`, `.jsx`, and `index.ts`/`index.js` forms. Simple identifier parameters and returned expressions are supported. Resolved calls are represented in evidence; cycles and recursion are bounded.
- **Python:** supports straight-line source assignment/subscript, simple variable aliases, SQL-literal concatenation with a tracked input variable, and direct execution of a tracked query variable. It does not claim Python function-parameter, call, or return propagation. Relevant unsupported constructs produce PARTIAL diagnostics rather than findings.
- **All languages:** branches, loops, destructuring, complex expressions, framework adapters, dynamic dispatch, unresolved calls, and other unsupported semantics are not inferred as exact. A tainted value reaching an unresolved call is reported as `UNRESOLVED_REFERENCE`, produces no finding for that unresolved path, and makes security coverage PARTIAL; an unrelated unresolved import does not by itself make the analyzer partial. No runtime execution or compiler-grade data-flow analysis is performed.

An unresolved `CALLS` relationship is never treated as an exact propagation edge. If the full source-to-sink chain cannot be established, the analyzer emits no HIGH-confidence SQL injection finding. Constructing SQL-shaped text or passing it to a local helper that does not call a recognized database sink is not sufficient.

## Evidence and persistence

Every emitted candidate carries a complete source-to-sink evidence path with `SOURCE`, propagation/transformation/parameter/return/call nodes as applicable, and a `SINK` node. Nodes and edges carry `SECURITY_ANALYZER` provenance and exact resolution. The existing orchestrator persists the candidate using the existing Finding and FindingOccurrence repositories, then writes an authoritative, sufficient, complete evidence snapshot through the existing EvidenceRepository. The graph remains occurrence- and tenant-scoped; no second persistence model or migration is introduced.

If source, Code IR mapping, scope, call resolution, or budgets are incomplete, the analysis is PARTIAL and does not fabricate a vulnerability finding. Finding identity includes semantic function/sink identity and flow facts through the existing normalization/idempotency path; it is not file-and-line-only.

## Resource limits and isolation

The analyzer respects the existing `maxFiles`, `maxEntities`, and `maxDurationMs` budgets. It additionally bounds taint evidence to 500 nodes, 1,000 edges, 100 paths, and 16 propagation/call levels per analysis. On exhaustion it preserves findings already produced, emits diagnostics, and returns PARTIAL. A security-analyzer failure is isolated by the existing orchestrator; already persisted Structural/Quality results are not rolled back by the security analyzer.

## Deferred

XSS, command injection, path traversal, SSRF, unsafe deserialization, secret detection, dependency CVEs, dynamic execution, sandbox execution, and autonomous fixes are **not implemented**. AI explanation is optional and advisory only. Deterministic risk scoring is implemented separately; see [RISK.md](RISK.md).
