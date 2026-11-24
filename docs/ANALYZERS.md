# Analyzer framework

## Status

**IMPLEMENTED (Structural/Quality v1, partial deterministic Security/Taint v1, deterministic Risk Engine v1, and PostgreSQL durable queue/run-scoped graph storage; live database acceptance remains outstanding).** `POST /analysis` creates/reuses the PostgreSQL run/job row transactionally. A worker claims that row with `FOR UPDATE SKIP LOCKED`, reloads its run/profile/repository/commit, builds run-scoped Code IR and Repository Intelligence, resolves the run's analysis scope, invokes `AnalyzerOrchestrator`, persists findings and occurrences through the existing finding repository, writes immutable per-occurrence evidence snapshots through the existing evidence repository, creates a versioned Risk Assessment, and records run coverage/status. The registered `security` analyzer currently implements only `SECURITY.SQL_INJECTION`; supported language constructs and uncertainty boundaries are limited as described in [SECURITY.md](SECURITY.md). Development API startup manages the local worker; production runs it separately with `pnpm --filter @bugzero/workers start`. API hosts must supply a trusted authentication adapter. See [EVIDENCE.md](EVIDENCE.md) and [RISK.md](RISK.md) for evidence and risk contract limits.

Other security families, dependency CVEs, and AI are not implemented. The SQL injection analyzer is conservative and partial; see [SECURITY.md](SECURITY.md). Later planned lifecycle stages remain deferred.

## Runtime path

```text
Client request
  -> Fastify API authentication / tenant authorization
  -> analysis_run + analysis_job transaction
  -> PostgreSQL durable job (atomic lease claim)
  -> AnalysisJobProcessor
  -> load analysis_job / analysis_run / profile / repository / commit
  -> read the exact Git commit source snapshot
  -> PARSING: parser -> run-scoped CodeGraphRepository
  -> INTELLIGENCE: RepositoryIntelligenceBuilder
  -> ImpactAnalysisEngine for changed-file / affected-symbol scopes
  -> QUALITY_ANALYSIS: AnalyzerOrchestrator
       ├── StructuralQualityAnalyzer
       └── SqlInjectionAnalyzer (SECURITY.SQL_INJECTION)
  -> FindingRepository.createOrGet / createOccurrenceIfAbsent
  -> EvidenceRepository.createGraph (snapshot, nodes, edges, paths)
  -> DeterministicRiskEngine.assess -> RiskAssessmentRepository
  -> update current-risk projection without changing disposition
  -> RepositoryHealthEngine -> HealthRepository.createOrGetSnapshot
  -> update analysis run coverage and status
```

The processor advances the existing `analysis_jobs.stage` through `PARSING`, `INTELLIGENCE`, and `QUALITY_ANALYSIS`; it does not add a job model or a second queue. Runs with no supported parsed source files or no analyzer results are marked `PARTIAL`, with diagnostics stating that source-level findings could not be ruled out. Pipeline timings, parsed file counts, IR entity/relationship counts, scope/impact completeness, analyzer/evidence/risk/health metrics, diagnostics, and finding count are recorded in the existing `analysis_runs.coverage` JSON. Health is a deterministic aggregation stage after persisted risk, not an analyzer; unsupported health dimensions remain unknown. See [HEALTH.md](HEALTH.md).

## Implemented Structural/Quality rules

| Rule | Behavior |
|---|---|
| `LONG_FUNCTION` | Uses parser-derived inclusive function/method source spans. More than 100 lines triggers; exactly 100 does not. |
| `HIGH_PARAMETER_COUNT` | Counts exact `DECLARES` relationships to `PARAMETER` entities. More than 7 triggers; exactly 7 does not. |
| `HIGH_FAN_OUT` | Counts distinct exact outgoing `CALLS` relationships from Repository Intelligence. More than 15 triggers; exactly 15 does not. |
| `HIGH_FAN_IN` | Counts distinct exact incoming `CALLS` relationships from Repository Intelligence. More than 20 triggers; exactly 20 does not. |
| `EMPTY_FUNCTION` | Requires available source and an explicit Python `pass` body or empty JavaScript/TypeScript function/method/arrow block. It avoids declaration-only and abstract methods, and does not infer emptiness when source is missing. |

`DEEP_NESTING` is **DEFERRED/UNSUPPORTED** because the IR does not provide reliable nesting depth. No value is inferred from unrelated metadata.

## Implemented Security rule

`security` v1.0.0 is registered with the same `AnalyzerRegistry` and executes through the same `AnalyzerOrchestrator`.

| Rule | Behavior |
|---|---|
| `SECURITY.SQL_INJECTION` | HIGH severity; requires an exact supported input source, bounded propagation, an exact recognized SQL sink, SQL-shaped dynamic construction, and a complete evidence path. Recognized static placeholder queries with separate bound arguments are not findings. |

Unresolved or unsupported relevant flow is not upgraded into a vulnerability; it produces PARTIAL status/diagnostics where detected. Exact source/sink patterns, propagation support, language-specific limits, budgets, and non-goals are in [SECURITY.md](SECURITY.md).

AI is not authoritative and does not decide this rule. The deterministic analyzer creates the candidate; the existing finding normalization, Finding/Occurrence repositories, and occurrence-linked EvidenceRepository persist it. No second lifecycle or persistence model is used.

## Risk assessment

The evidence snapshot is persisted before deterministic Risk Engine v1 scores the finding. Assessment inputs preserve unknown reachability/exploitability and unavailable dependency/module dimensions rather than inferring them. Assessments are immutable and idempotent by occurrence and profile version; failures leave findings/evidence intact and mark the analyzer result PARTIAL. See [RISK.md](RISK.md) for the exact scoring profile and caveats.

## Scope and limits

- `COMMIT` and `REPOSITORY` runs map to `FULL`.
- `CHANGED_FILES` resolves selected paths to changed entities and passes those roots through the existing `ImpactAnalysisEngine`; the analyzer scope contains those roots plus the returned impacted entities. An absent or empty selection does not widen scope.
- `AFFECTED_SYMBOLS` uses explicitly supplied `changedEntityIds` from the existing job `scope_key` JSON and the same impact engine. Missing roots produce an empty, incomplete `IMPACTED` scope.
- `PR` has no reliable diff contract here and is not widened to `FULL`.
- Worker defaults are `maxFiles=2000`, `maxEntities=20000`, and `maxDurationMs=60000`; callers may pass a stricter budget. File/entity budgets cap parsing and persistence; the remaining duration is passed to the analyzer. Findings produced before a limit remain in the result, with `PARTIAL` status, diagnostics, and metrics.
- `maxFiles` is applied after the Git provider has checked out and read supported source files; the clone/read and an individual parser/intelligence operation are not interruptible. Duration is checked between files, passed as the remaining analyzer budget, and recorded as exceeded if the overall run passes the limit; it is not a hard process kill.
- A partial parse, incomplete impact analysis, failed analyzer, unavailable required source, or failed intelligence build prevents a `COMPLETED` run.

## Known limitations

- JavaScript/TypeScript parsing uses the TypeScript compiler AST. It emits declaration/method boundaries, declared parameter entities, variable declarations, and same-file direct identifier/`this.method()` calls only when the target is unique and not shadowed by a known local binding. The SQL analyzer separately follows unambiguous named/default relative imports, namespace imports, and static CommonJS `require` bindings to exported functions in the already-loaded repository snapshot; these analyzer-local links are not persisted as Code IR relationships.
- Python parsing is a bounded structural parser based on indentation and lexical masking rather than a full Python AST. Every Python parse is marked `PARTIAL` until full grammar validation is available. It extracts ordinary `def`/`async def`, classes, parameter lists, and unique same-file direct-name calls; security analysis supports only the straight-line subset documented in [SECURITY.md](SECURITY.md), not Python interprocedural propagation.
- Dynamic calls, ambiguous/shadowed names, unresolved names, and unsupported cross-file targets are not emitted as exact `CALLS` relationships. Static CommonJS support covers literal relative `require()` calls with identifier or object-destructuring bindings and statically assigned `module.exports`/`exports` functions. Unresolved values remain tainted and unknown; security coverage becomes PARTIAL only when SQL-shaped taint reaches an unresolved call or unknown taint reaches a recognized SQL sink. Unrelated unresolved flows do not by themselves prevent completion. No runtime repository code is executed.
- Git source access clones the persisted repository URL at the run's exact commit. Private-repository credential provisioning remains dependent on the configured clone URL/environment.
- The worker requires Neon PostgreSQL (`DATABASE_URL`), a separate dedicated queue-role URL (`DATABASE_QUEUE_URL`), and all ordered SQL migrations. Apply migrations using `DATABASE_URL_UNPOOLED` set to the direct connection URL for a verified Neon branch, then run `pnpm --filter @bugzero/database migrate`. Migration 0014 adds durable queue leasing/retries and run-scoped PostgreSQL code graph storage; it is forward-only and must be tested against a disposable Neon branch before deployment.
- Unit tests exercise queue claim/retry behavior and graph persistence through injected PostgreSQL adapters. Database-backed migration, concurrency, retry, RLS, graph replay, and API/UI end-to-end acceptance for migration 0014 remain outstanding.
- No 1M-LOC capacity claim is made.
- The API create/status route is present. EdDSA JWT authentication is implemented and verified; a production identity provider is not included in this repository — `createApiServer` requires the hosting application to inject a trusted resolver or configure `AUTH_PUBLIC_KEY`/`AUTH_ISSUER`/`AUTH_AUDIENCE`. Live end-to-end acceptance of the current PostgreSQL-only pipeline remains outstanding.
