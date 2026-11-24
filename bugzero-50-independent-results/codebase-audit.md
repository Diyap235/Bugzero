# BugZero Codebase and Complexity Audit

**Snapshot:** 2026-10-10  
**Scope:** Current working tree; bounded review of the source-to-health execution path.  
**Result:** Audit only. No application source or fixture labels/results were changed.

## 1. Executive summary

The implemented path follows the documented architecture: source is read at a commit, parsed into Code IR, persisted, expanded into repository intelligence, analyzed deterministically, and then findings/evidence/risk/health are persisted in sequence. Tenant-scoped repositories, occurrence idempotency, bounded evidence, and explicit partial/unknown states are important protections and should not be removed as “overhead.”

Five correctness risks were confirmed in the current tree:

1. TypeScript conditional expressions can hide a tainted branch while returning `COMPLETED` with no diagnostic.
2. Supported-looking Python source-to-sink flow at module scope is silently skipped and also returns `COMPLETED`.
3. The Python taint map retains taint after a variable is reassigned to a constant, producing a false positive.
4. A severity-derived placeholder is written to `findings.current_risk` before risk-assessment persistence; on persistence failure that placeholder remains, contrary to the documented failure contract.
5. SQL finding identity includes the sink’s physical line number, so inserting lines can split one continuing issue into multiple finding identities.

Runtime probes reproduced the first three outcomes. Existing focused tests pass, but currently do not cover those cases. The current dirty test for risk persistence explicitly asserts the placeholder value, conflicting with `docs/RISK.md`.

The largest analyzer and pipeline modules are large because they contain substantial analysis and persistence responsibilities, not because line count alone proves code should be removed. Refactoring should follow correctness fixes and retain the existing bounds, evidence, uncertainty, idempotency, and failure behavior.

## 2. Baseline, inventory, and execution path

### Baseline

Before investigation, `git status --short` showed **27 changed paths**: 22 modified tracked files and 5 untracked paths. The existing diff was **685 insertions / 52 deletions across 22 tracked files**, in addition to the untracked fixture/results/migration/config paths. This audit preserves all of them. The requested report is an additional file under the already-untracked `bugzero-50-independent-results/` directory.

Several dirty files overlap the audit path, including the SQL analyzer, analyzer orchestrator, health engine, analysis job, worker tests, and health/database documentation. Findings describe the current working tree and do not attribute these changes to a particular author.

### Inventory

- Scoped inventory: 170 TypeScript/TSX/JavaScript/Python source files and 27 test files in the project source/test roots. Installed dependencies and generated output were excluded from the successful inventory.
- Runtime/tooling: pnpm workspace for `apps/*` and `packages/*`; TypeScript/Node; Next.js/React web; Fastify API; BullMQ/Redis workers; PostgreSQL via `pg`; shared Zod contracts. `engine/pyproject.toml` declares an empty-dependency Python placeholder package.
- Package entry points: API exports its server and analysis routes; workers expose selected job/provider/AI adapters; database and contracts expose package roots. The parser is not a declared worker package subpath export.
- Test coverage is concentrated in worker/API/database tests. The focused tests exercise parser, SQL detection, analyzer persistence, evidence, risk, health, jobs, and migration definitions. Database migration/unit tests do not by themselves establish live database behavior.

### Critical execution path traced

`AnalysisJobProcessor.process` validates tenant/job/run identity and records failure/retry status. `executePipeline` reads the selected commit, applies file/entity/time budgets, parses supported files, persists entities and relationships, builds Repository Intelligence and scope, and invokes the `AnalyzerOrchestrator`. The orchestrator normalizes candidates, persists stable findings and immutable occurrences, builds/persists evidence, persists risk assessments, then updates the current-risk projection. The job processor aggregates health signals, calculates and persists the health snapshot, and reports stage coverage and partial/failure status.

Principal path files:

- [`process-analysis-job.ts`](../worker/src/jobs/process-analysis-job.ts), `process` / `executePipeline`
- [`language-adapters.ts`](../worker/src/parser/language-adapters.ts), TypeScript and Python parsing
- [`analyzer-orchestrator.ts`](../worker/src/analyzers/analyzer-orchestrator.ts), candidate-to-persistence path
- [`sql-injection-analyzer.ts`](../worker/src/analyzers/security/sql-injection-analyzer.ts), deterministic SQL source-to-sink logic
- [`finding-evidence.ts`](../worker/src/evidence/finding-evidence.ts), finding evidence graph
- [`findings.repository.ts`](../packages/database/src/repositories/findings.repository.ts), finding/occurrence identity and idempotency
- [`health-engine.ts`](../worker/src/health/health-engine.ts), repository-health calculation

## 3. Prioritized findings

### 1. Conditional expressions can produce a clean result despite a tainted branch

- **Classification:** CORRECTNESS BUG — missed detection / misleading completion
- **Location:** [`sql-injection-analyzer.ts`](../worker/src/analyzers/security/sql-injection-analyzer.ts), `evaluateExpression`, lines 494–501
- **Evidence and callers:** The conditional-expression case evaluates only `whenTrue`; it does not inspect the condition or `whenFalse`. `executeStatements` stores that result, and later `evaluateCall` sees a clean query value. The caller is `SqlInjectionAnalyzer.analyze`, which evaluates each TypeScript/JavaScript module and function.
- **Observed impact:** A probe with `flag ? "SELECT 1" : "SELECT ... " + req.query.id`, followed by `db.query(query)`, returned `COMPLETED`, zero findings, and no diagnostics. The injected branch was ignored.
- **Minimal change:** Analyze both possible arms conservatively and preserve branch-specific flow evidence; when the flow cannot be represented/proven within existing limits, report `PARTIAL` rather than a clean result.
- **Risk of change:** Medium. Naive merging can fabricate a path or overstate certainty. Preserve exact source-to-sink evidence and add branch-specific tests.
- **Tests required:** Tainted false arm and true arm, clean arm paired with tainted arm, both-clean branches, and uncertain branch flow remaining partial.

### 2. Python module-scope SQL flow is silently omitted

- **Classification:** CORRECTNESS BUG — missed detection / misleading completion
- **Location:** [`sql-injection-analyzer.ts`](../worker/src/analyzers/security/sql-injection-analyzer.ts), `analyzePython`, lines 1197–1210 and 1365–1392
- **Evidence and callers:** `activeFunction` is assigned only when a `def` line is encountered. The candidate-emission branch requires `activeFunction`; a recognized module-scope source, dynamic SQL assignment, and `db.execute(query)` therefore cannot emit a candidate, and that branch adds no diagnostic. `SqlInjectionAnalyzer.analyze` still reports the resulting status.
- **Observed impact:** A module containing `request.args.get("id")`, SQL concatenation, and `db.execute(query)` parsed as `PARSED` and returned `COMPLETED`, zero findings, and no diagnostics.
- **Minimal change:** Either support module scope using its persisted module entity and accurate source evidence, or explicitly mark recognized unsupported module-scope flow `PARTIAL`. Do not silently treat it as clean.
- **Risk of change:** Medium. Module-level evidence must not invent a callable function or claim unsupported interprocedural flow.
- **Tests required:** Tainted and clean module-scope SQL, module-level source with no sink, and the existing supported function-scope cases.

### 3. Python taint survives reassignment to a clean constant

- **Classification:** CORRECTNESS BUG — false positive
- **Location:** [`sql-injection-analyzer.ts`](../worker/src/analyzers/security/sql-injection-analyzer.ts), `analyzePython`, lines 1244–1340 and sink handling at 1365–1392
- **Evidence and callers:** The `variables` map is updated for recognized input, concatenation, and alias assignments. An assignment such as `user = "constant"` matches none of those cases and does not kill the prior taint value. The later SQL concat/sink therefore consumes stale taint.
- **Observed impact:** A probe that assigned request input to `user`, overwrote `user` with a constant, then concatenated it into SQL returned `COMPLETED` with one high-confidence finding and no diagnostic.
- **Minimal change:** Track each supported assignment’s new value and replace the prior binding; for assignments whose value cannot be safely classified, preserve uncertainty and mark affected flow partial instead of reusing stale taint.
- **Risk of change:** Medium. Incorrectly killing taint through unsupported aliasing or mutation could introduce false negatives.
- **Tests required:** Constant overwrite removes taint; tainted reassignment preserves taint; unknown reassignment is partial; existing alias/concatenation and parameterized-query baselines remain unchanged.

### 4. Risk-persistence failure leaves a severity placeholder as current risk

- **Classification:** CORRECTNESS BUG — misleading score/projection after failure
- **Location:** [`analyzer-orchestrator.ts`](../worker/src/analyzers/analyzer-orchestrator.ts), lines 118–128 and 227–280; failure test [`analyzers.test.ts`](../worker/tests/analyzers.test.ts), line 626
- **Evidence and callers:** Before the evidence-linked assessment is persisted, `createOrGet` receives `currentRisk: this.toRisk(candidate.severity)` (for HIGH, 75). The finding repository writes that field for both new and matched findings. If risk-assessment persistence fails, the catch marks the result partial, but the earlier projection write is not rolled back. The current dirty test explicitly expects `current_risk === 75` after failure.
- **Impact:** Consumers of the finding projection can mistake a severity lookup value for the deterministic, evidence-aware risk assessment. This conflicts with [`RISK.md`](../docs/RISK.md), which says failed assessment persistence does not advance the projection, and with the update-after-persistence ordering in the risk design.
- **Minimal change:** Make the projection advance only after successful assessment persistence. Because `findings.current_risk` is `NOT NULL` in migration `0001`, represent “not yet assessed” explicitly or use an appropriate transaction/initialization design; do not replace the placeholder with another invented numeric value.
- **Risk of change:** Medium/high. It touches an established persistence contract and may require an additive schema/API change; preserve idempotent replay and prior current risk on failure.
- **Tests required:** New finding and existing finding cases for risk persistence failure; assert no unpersisted projection is published; assert successful assessment advances projection; validate PostgreSQL constraint/migration behavior.

### 5. SQL semantic identity changes when the sink line moves

- **Classification:** CORRECTNESS BUG — finding history fragmentation
- **Location:** [`sql-injection-analyzer.ts`](../worker/src/analyzers/security/sql-injection-analyzer.ts), lines 727 and 1398; [`analyzer-orchestrator.ts`](../worker/src/analyzers/analyzer-orchestrator.ts), lines 390–399
- **Evidence and callers:** TypeScript/JavaScript `semanticTarget` embeds the sink line; Python embeds `index + 1`. `buildIdentityFingerprint` hashes `semanticTarget` along with analyzer/rule versions, but not a line-independent sink identity. `execute` supplies that fingerprint to `FindingRepository.createOrGet`.
- **Impact:** Inserting lines before the same vulnerable sink changes the finding fingerprint and can create a second stable Finding instead of a new occurrence on the existing Finding. This weakens cross-revision history and conflicts with the semantic identity goal in ADR-004.
- **Minimal change:** Separate stable sink identity from occurrence location. Derive a line-independent target from the function and normalized sink/source-flow semantics, keep physical lines on the occurrence/evidence, and retain enough sink identity to distinguish multiple sinks in one function.
- **Risk of change:** High if fingerprints are changed without a versioned migration/compatibility plan; accidental identity merging is also harmful.
- **Tests required:** Same issue after line insertion preserves finding identity and creates a new occurrence; distinct sinks remain distinct; retries remain idempotent; existing identity-version compatibility is preserved.

### 6. Python parse status does not validate the Python grammar

- **Classification:** UNVERIFIED — analysis-completeness risk
- **Location:** [`language-adapters.ts`](../worker/src/parser/language-adapters.ts), `parsePython`, lines 388–543
- **Evidence:** Python parsing is lexical/indentation-based; status is `PARSED` whenever its small diagnostics list is empty. It does not use a Python grammar parser and does not diagnose every unsupported statement/construct. The security analyzer does produce explicit partial diagnostics for some unsupported flows, but that is not a general parser diagnostic.
- **Impact:** The documented Python subset is appropriately limited, but the boundary between “not modeled” and “completed” needs validation for constructs that can affect source/taint mapping.
- **Minimal change:** Add only narrow diagnostics for identified unsupported constructs that can affect a relevant conclusion; otherwise retain the documented limitation and mark the audit item unresolved. Do not add an analyzer category or claim full Python parsing.
- **Risk of change:** Medium. Broadly flagging ordinary syntax as partial could make useful supported analysis unusable; detection should be narrowly tested.
- **Tests required:** Representative unsupported grammar and taint-affecting statements must produce explicit partial status; existing supported subset remains complete. No exhaustive parser rewrite is recommended from this audit alone.

## 4. Dead code, duplication, and abstractions

### Confirmed low-risk cleanup

- **DEAD CODE:** [`language-adapters.ts`](../worker/src/parser/language-adapters.ts), line 609 defines `parserAdapters`, but no caller uses it. `parseWithLanguageAdapter` at lines 604–606 instead calls `getLanguageAdapters()` for every parse, constructing a second list each time. The parser module is not a worker package subpath export. Minimal change: have parsing use one adapter list (or remove the unused constant); test supported and unsupported language selection. Regression risk: low if adapter ordering and behavior are unchanged.
- **DEAD CODE:** [`rule-registry.ts`](../worker/src/analyzers/security/rule-registry.ts), line 14 `SecurityRuleRegistry.list()` has no caller. The registry itself is used to register/check the SQL rule; it is distinct from `AnalyzerRegistry` and should not be removed merely because it currently contains one rule. Minimal change: remove only `list()` if no planned internal consumer exists. Risk: low, but retain the registration contract/test.

### Confirmed duplication / simplification candidate

- **DUPLICATION:** Canonical stable serialization and SHA-256 hashing are implemented separately in [`finding-evidence.ts`](../worker/src/evidence/finding-evidence.ts), lines 33–42, and [`analyzer-orchestrator.ts`](../worker/src/analyzers/analyzer-orchestrator.ts), lines 425–438. They currently use the same sorted-key serialization and digest pattern. A small shared internal utility may reduce drift, but changing serialization changes stable identities/fingerprints if output bytes differ. Regression risk: medium; require golden hash/identity tests before extraction.
- **UNVERIFIED:** `buildCacheKey` populates `ParsedFileResult.cacheKey`, but no production worker caller reads that value; the field is also in the shared contract schema. Do not call it removable dead code until the contract/cache intention is resolved. Either wire an actual bounded parser cache or document/retire the field through the contract’s change policy.
- **UNVERIFIED:** [`engine/`](../engine) is explicitly described as a future Python engine and contains placeholder functions with no repository callers. It is not part of the pnpm workspace and has an empty dependency list. This is dormant scaffolding, but its declared Python package may be an intended distribution surface; do not delete it without a product/API decision.
- The security rule registry is not the analyzer registry: the former stores security rule metadata and the latter selects executable analyzers. Merging them would conflate separate responsibilities and is not recommended based on this audit.

## 5. Largest files and whether size is justified

Line counts are from the scoped inventory; they are not, by themselves, a deletion rationale.

| File | Lines | Assessment |
|---|---:|---|
| [`sql-injection-analyzer.ts`](../worker/src/analyzers/security/sql-injection-analyzer.ts) | 1,472 | Largest critical-path source file. Its size corresponds to AST flow evaluation, import/call resolution, evidence and budgets, plus a distinct conservative Python subset. Oversized for navigation/maintenance; consider extracting language-specific internals only after the accuracy fixes and with unchanged behavior tests. |
| [`process-analysis-job.ts`](../worker/src/jobs/process-analysis-job.ts) | 775 | Pipeline and source-provider concerns share a file. Stage ordering/status/error recovery are required; extracting source-provider implementations is a reasonable low-risk first step, but avoid fragmenting the ordered pipeline into generic stage abstractions. |
| [`language-adapters.ts`](../worker/src/parser/language-adapters.ts) | 565 | Contains separate TypeScript AST and Python lexical parsers. Splitting by language could improve isolation, but preserve parse status, provenance, stable IDs, and current unsupported-language behavior. |
| [`analyzer-orchestrator.ts`](../worker/src/analyzers/analyzer-orchestrator.ts) | 449 | Large but holds consequential finding→occurrence→evidence→risk ordering and failure isolation. Correctness and projection semantics take precedence over splitting it. |
| [`finding-evidence.ts`](../worker/src/evidence/finding-evidence.ts) | 404 | Bounded graph construction, exact relationship filtering, provenance and completeness are substantive safety requirements; not obvious dead weight. |
| [`health-engine.ts`](../worker/src/health/health-engine.ts) | 301 | Profile validation, unknown/partial handling, deduplication and weighted aggregation appear proportionate to the documented health contract. |
| [`src/app/page.tsx`](../src/app/page.tsx) | 1,147 | Largest overall file in the inventory, but outside the requested analysis path and not inspected deeply; size justification is **UNVERIFIED**. |
| [`security-sql-injection.test.ts`](../worker/tests/security-sql-injection.test.ts) | 825 | Focused safety/accuracy coverage is valuable and justified; add regressions for the probes rather than reducing the suite. |

## 6. Required complexity to preserve

- Source-at-commit processing and source code as the authority; derived IR/intelligence must remain rebuildable.
- Resource budgets and explicit partial/unknown results. Do not turn parse, scope, source-access, or budget failures into a clean analysis.
- Deterministic analyzers as the proof authority; AI/ML remain advisory/investigative.
- Conservative call/import resolution and exact evidence edges. Unsupported or ambiguous flows must not be upgraded to exact.
- Stable Finding versus immutable FindingOccurrence separation, tenant-scoped idempotency, retry-safe upserts, and historical immutability.
- Evidence snapshots bound to their occurrence/run/repository/commit, with provenance, sufficiency/completeness, diagnostics, and bounded graph traversal.
- Risk persistence before projection advancement, and health consuming persisted risk rather than re-running finding/risk logic.
- Independent analyzer-failure handling so prior persisted results are not discarded.

These are architectural/safety costs, not accidental complexity to optimize away.

## 7. Recommended changes in small, independently testable steps

1. Fix and add tests for TypeScript conditional-arm coverage; keep unsupported flow partial when proof is incomplete.
2. Fix Python module-scope reporting/coverage semantics, then implement correct assignment kill/update semantics; test each separately.
3. Correct risk projection ordering and failure semantics. Resolve the `NOT NULL` current-risk representation before changing persistence behavior.
4. Version and improve SQL finding identity to exclude physical lines while keeping occurrence locations and distinguishing multiple sinks.
5. Reconcile parser status for narrowly identified unsupported constructs; do not claim full Python grammar support.
6. Remove or reuse the unused parser adapter list and unused security-registry `list()` method. Consider stable-serializer extraction only with byte-for-byte fingerprint compatibility tests.
7. After the correctness work, split Python/TypeScript analyzer internals or source providers in small moves, running the targeted tests at each step.
8. Reconcile conflicting live-database validation statements before relying on them as evidence.

## 8. Validation and commands run

### Passed

```text
pnpm exec node --import tsx --test worker/tests/security-sql-injection.test.ts worker/tests/analyzers.test.ts worker/tests/health.test.ts worker/tests/analysis-job.test.ts
Result: 63 tests, 63 passed, 0 failed.

pnpm exec tsc --noEmit -p worker/tsconfig.json
Result: exit 0.

pnpm exec node --import tsx --test tests/parser.test.ts worker/tests/security-sql-injection.test.ts worker/tests/analyzers.test.ts worker/tests/evidence.test.ts worker/tests/risk-engine.test.ts worker/tests/health.test.ts worker/tests/analysis-job.test.ts packages/database/tests/migrations.test.ts
Result: 80 tests, 80 passed, 0 failed.

pnpm exec node --import tsx --input-type=module -
Result: inline, non-persisted runtime probes. Conditional TypeScript flow: COMPLETED / 0 findings / no diagnostics. Python clean overwrite: COMPLETED / 1 finding / no diagnostics.

pnpm exec node --import tsx --input-type=module -
Result: inline, non-persisted module-scope Python probe. Parser: PARSED; analyzer: COMPLETED / 0 findings / no diagnostics.
```

The two `node ... -` invocations consumed PowerShell here-string input; no probe files were created.

### Not run / failed discovery attempt

- The 48-case/independent score audit was **not run**, as requested.
- No full monorepo suite, live PostgreSQL/Redis run, build, or frontend test was run. Focused migration tests inspect definitions; they are not a substitute for live persistence validation.
- An initial root-wide PowerShell recursive source inventory encountered a disappearing path under `node_modules\.pnpm\node_modules\@bugzero\shared` and continued traversing installed dependencies past the initial wait. It was stopped. The successful inventory reran over explicit project source/test roots, excluding installed/generated output. No application files were changed by that attempt.
- No test or typecheck failure or timeout occurred in the completed validation commands.

## 9. Documentation evidence discrepancy

Persistence validation claims conflict:

- [`FINDINGS.md`](../docs/FINDINGS.md), line 11 says migrations were applied to live PostgreSQL and verified idempotent; line 24 says no live PostgreSQL was available and constraint behavior was not claimed.
- [`HEALTH.md`](../docs/HEALTH.md), line 81 claims live PostgreSQL and Redis/BullMQ end-to-end verification.
- [`RISK.md`](../docs/RISK.md), lines 5 and 38 claim live DB verification while also saying the worker/migration tests do not validate live PostgreSQL constraints.
- [`EVIDENCE.md`](../docs/EVIDENCE.md), line 5 says evidence is not live-DB verified.

**Classification:** UNVERIFIED documentation inconsistency. Reconcile against dated test logs/CI evidence and state precisely which migrations, constraints, triggers, and integrations were exercised. This audit did not perform a live database validation.
