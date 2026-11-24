# Investigation: Missing Risk Assessments and Misleading Health Scores

## Executive summary

The saved 48-case audit did not expose a Risk Assessment persistence or queue failure. Its 48 jobs completed, with 28 `COMPLETED` and 20 `PARTIAL` analysis runs, no `DEAD_LETTER` runs, and no findings, evidence snapshots, or Risk Assessments in any run. Risk calculation and persistence are downstream of a finding candidate, so the earliest loss was in analysis: the SQL analyzer either silently failed to propagate a supported TypeScript/JavaScript request value through `??` or `||`, or reported unsupported Python syntax and marked the security analysis `PARTIAL`.

I fixed taint propagation through `??` and `||`, and added analyzer regression coverage. A single real post-fix run of the existing TypeScript positive-control source completed through the live application/queue/worker/database path and persisted a finding, evidence snapshot, and Risk Assessment. Its persisted Risk Score was 80 and independently recalculated to 80. The Health Score was 91 from persisted dimension scores 84/100/100. The API Risk Score value was not captured for that run, so no API-to-persistence comparison is claimed.

The original 48 audit records have not been changed or rerun. The Health Score formula was not changed. Health coverage is still `PARTIAL` when dependency and reliability dimensions are unavailable, even if the analysis run itself completed.

## Root cause: why the audit had no Risk Assessments

`AnalyzerOrchestrator.execute` only enters finding creation, evidence graph persistence, risk calculation, and Risk Assessment persistence for each candidate in `result.findings` ([analyzer-orchestrator.ts:112-115](../worker/src/analyzers/analyzer-orchestrator.ts#L112)). The deterministic Risk Engine is called at line 172, and the repository insert is called at lines 227-229, inside that candidate loop. Therefore, an analyzer result with zero candidates never invokes the Risk Engine or `RiskAssessmentRepository.createOrGet`.

The persisted audit data reports zero findings, evidence snapshots, Risk Assessments, and risk persistence failures for each of the 48 cases ([results.json](./results.json); aggregate counts in [summary.md](./summary.md)). That is consistent with no candidates reaching the orchestrator. It is not evidence of a failed assessment insert. Risk persistence itself is an idempotent `INSERT ... ON CONFLICT` followed by a read of the existing record when needed ([risk-assessments.repository.ts:97-153](../packages/database/src/repositories/risk-assessments.repository.ts#L97)). In the later real positive-control run, that same worker path persisted one assessment with zero persistence failures.

The first confirmed defect was in `SqlInjectionFileAnalyzer.evaluateExpression`: request-derived values were not carried through nullish-coalescing or logical-OR fallback expressions. The analyzer recognized request-source expressions at [sql-injection-analyzer.ts:263-284](../worker/src/analyzers/security/sql-injection-analyzer.ts#L263), but the evaluator had no `??` or `||` branch before the fix. The new branch evaluates and combines both operands ([sql-injection-analyzer.ts:393-430](../worker/src/analyzers/security/sql-injection-analyzer.ts#L393)). This corrected four supported TypeScript/JavaScript cases; one other TypeScript case still has an unsupported source-boundary pattern, described below.

There was no original exception on the vulnerable cases discussed here. The TypeScript/JavaScript false negatives completed with zero findings and no analyzer diagnostics. The Python cases returned explicit unsupported-expression diagnostics and `PARTIAL`; they did not throw an exception. Consequently, there was no original worker exception to retry or dead-letter. For context, the queue allows three attempts ([analysis-queue.ts:27](../worker/src/jobs/analysis-queue.ts#L27)); thrown pipeline errors are what lead to retry/`DEAD_LETTER` handling ([process-analysis-job.ts:306-328](../worker/src/jobs/process-analysis-job.ts#L306)). That path was not the cause of the saved audit results.

## Stage-by-stage traces

### Completed vulnerable-labelled case: `case_017_ts_sqli_concat`

**Original saved audit run**

1. The fixture source was ingested into its independent local repository and submitted through the normal analysis endpoint (`POST /analysis`, [routes.ts:56](../backend/src/modules/analysis/routes.ts#L56)).
2. The worker read the persisted commit source, parsed it with the TypeScript adapter, and persisted Code IR entities and relationships ([process-analysis-job.ts:358-409](../worker/src/jobs/process-analysis-job.ts#L358)). The audit records show five IR entities, five relationships, no parse diagnostics, and a full analysis scope.
3. The TypeScript security analyzer recognized the database query sink and the request-source expression, but lost its taint at `req.query.id ?? ""`. It returned `COMPLETED` with zero findings and no diagnostics.
4. Because the orchestrator received no candidates, it created no finding occurrence or evidence graph and called neither the Risk Engine nor the Risk Assessment repository.
5. The run therefore reached `COMPLETED` with no persisted findings, evidence, or risk. Health inputs had no finding signals and analyzer scores of Security 100, Quality 100, and Maintainability 100.

**One post-fix live verification run**

The same positive-control source was subsequently uploaded and submitted through the real API, Redis queue, worker, parser/analyzer, repositories, and PostgreSQL path—not supplied by mocks. It completed and persisted one finding, one evidence snapshot, one Risk Assessment, and a health snapshot; risk persistence reported one assessment and zero failures. The persisted technical Risk Score of **80** independently recalculated to **80** from the saved assessment/profile inputs. The persisted Health dimension scores were Security **84**, Quality **100**, and Maintainability **100**. With persisted weights 55/25/20, `(84×55 + 100×25 + 100×20) / 100 = 91.2`, rounded to the persisted Health Score **91**. Overall health coverage remained `PARTIAL` because dependency and reliability dimensions are unavailable. The verification script did not capture the API Risk Score response, so that value is not compared here.

This one-run result demonstrates that a supported real finding now reaches persistence and that at least one persisted Risk Score can be independently recalculated. It does not validate the other fixture cases or every Risk Score path.

### `PARTIAL` case: `case_001_python_sqli_concat`

1. Its Python source was persisted and read through the same repository-source path. The structural Python parser produced four entities and three relationships without parser diagnostics ([language-adapters.ts:388](../worker/src/parser/language-adapters.ts#L388); persisted counts in [results.json](./results.json)).
2. The SQL analyzer encountered `user_id = request.args.get("id")` on line 2. The Python source recognizer expects a narrower direct assignment form ([sql-injection-analyzer.ts:1175-1181](../worker/src/analyzers/security/sql-injection-analyzer.ts#L1175)); `.get(...)` is outside that subset. It returned the diagnostic `Python source expression is outside the supported assignment subset` ([sql-injection-analyzer.ts:1424](../worker/src/analyzers/security/sql-injection-analyzer.ts#L1424)).
3. Security analysis was `PARTIAL`, with zero findings, zero evidence, and zero Risk Assessments. The worker's overall completeness predicate includes non-empty parse diagnostics, incomplete repository intelligence, incomplete impact, and non-completed analyzer statuses ([process-analysis-job.ts:521-525](../worker/src/jobs/process-analysis-job.ts#L521)); this case was `PARTIAL` because its security analyzer was partial.
4. Health snapshot persistence still ran after analyzer execution ([process-analysis-job.ts:542-546](../worker/src/jobs/process-analysis-job.ts#L542)). Its security score was null, while Quality and Maintainability were each 100. The overall score was 100 over the available dimensions, not a Security score.

## All 11 vulnerable-labelled cases with no Risk Assessment

For all 11 original audit cases, the persisted analyzer output had zero findings, so the orchestrator never attempted finding/evidence/risk persistence. The case labels and notes below are from the unchanged fixture manifest. No labels were edited.

| Case | Source pattern and observed result |
|---|---|
| `case_001_python_sqli_concat` | `request.args.get("id")`, then concatenation with `str(user_id)` passed to `cursor.execute`. Explicit unsupported Python source-expression diagnostic at line 2; security analysis `PARTIAL`. |
| `case_002_python_sqli_fstring` | `.get("q")` source and interpolated f-string SQL passed to `execute`. Explicit unsupported source-expression diagnostic at line 2; security analysis `PARTIAL`. |
| `case_012_python_sqli_execute_variable` | `.get("account")`, then SQL concatenation including `str(account)` stored in `sql` and passed to `execute`. Explicit unsupported source-expression diagnostic at line 2; security analysis `PARTIAL`. |
| `case_013_python_sqli_multiline` | `.get("order_id")` flows into a multiline SQL concatenation before `execute`. Explicit unsupported source-expression diagnostic at line 2; security analysis `PARTIAL`; multiline expression handling is also outside the demonstrated subset. |
| `case_041_python_nested_sqli` | `request.args.get("sku")` is passed into a nested helper whose SQL uses the helper value. Explicit unsupported source-expression diagnostic at line 5; nested helper argument propagation is not proven by this analyzer. Security analysis `PARTIAL`. |
| `case_043_python_sqli_comment` | `.get("id")` source followed by SQL concatenation and `execute`, with a comment in the source. Explicit unsupported source-expression diagnostic at line 3; security analysis `PARTIAL`. |
| `case_017_ts_sqli_concat` | `req.query.id ?? ""` is concatenated into a recognized SQL query. Historical run completed with zero findings and no diagnostic because taint was dropped through `??`. The operator gap is fixed and this exact source produced a persisted finding/risk assessment in the one-run live verification; the 48-case audit itself was not rerun. |
| `case_019_ts_sqli_template` | `req.query.term ?? ""` is interpolated into a SQL template literal. Historical run completed with zero findings and no diagnostic because taint was dropped through `??`. The operator gap is fixed; this case was not separately rerun. |
| `case_026_ts_sqli_concat_variable` | Request-derived value is defaulted through `??`, used in a concatenated query variable, then passed to `db.query`. Historical run completed with zero findings and no diagnostic because taint was dropped through `??`. The operator gap is fixed; this case was not separately rerun. |
| `case_033_js_sqli` | `req.query.id || ""` is concatenated into a recognized SQL query. Historical run completed with zero findings and no diagnostic because taint was dropped through `||`. The operator gap is fixed; this case was not separately rerun. |
| `case_031_ts_sqli_double_concat` | SQL concatenates `name` and `tenant` function parameters, but neither is read from a recognized request-root source. The current source recognizer taints supported request-object property reads; it does not treat every string parameter as untrusted. This completed with zero findings and no diagnostic. This is an unsupported source-boundary/interprocedural contract, not a risk persistence defect, and remains unresolved. Automatically tainting all parameters was not added because it could create broad false positives. |

The Python structural parser's successful Code IR output does not imply that its expression-level security analyzer supports the file's syntax. For the six Python cases, the analyzer does report incomplete coverage instead of silently declaring security analysis complete. For the four fixed TypeScript/JavaScript cases, the fallback-expression gap was silent and therefore more misleading. `case_031_ts_sqli_double_concat` remains a silent coverage gap pending an explicit source-boundary policy and test.

## Health Score calculation and interpretation

The audit's persisted profile has Security/Quality/Maintainability weights **55/25/20**. The formula normalizes the weighted mean over only dimensions with non-null scores ([health-engine.ts:76](../worker/src/health/health-engine.ts#L76), [health-engine.ts:286-289](../worker/src/health/health-engine.ts#L286)). It does not assign zero to an unavailable dimension. That is mathematically consistent with the persisted formula, but a value of 100 can represent only a subset of the intended signal.

* For `case_001`, the saved inputs were Security `null`, Quality `100`, Maintainability `100`, and available weight `45`: `(100×25 + 100×20) / 45 = 100`. The arithmetic is correct; it is not evidence of a secure result because the Security dimension was unscored.
* For the original `case_017` run, all three analyzer dimensions were scored 100 with available weight 100: `(100×55 + 100×25 + 100×20) / 100 = 100`. The arithmetic matches those persisted inputs, but the inputs omit a real SQL injection finding. This is a misleading security result caused by the analyzer false negative.
* The verified post-fix `case_017` run had Security 84, Quality 100, and Maintainability 100, with all three weights available: `(84×55 + 100×25 + 100×20) / 100 = 91.2`, rounded to **91**.

The health engine sets Dependency and Reliability to unavailable today ([health-engine.ts:278-279](../worker/src/health/health-engine.ts#L278)). Overall coverage is `COMPLETE` only when upstream analysis is complete and every dimension is complete ([health-engine.ts:290-294](../worker/src/health/health-engine.ts#L290)). Thus all audit snapshots had `PARTIAL` overall coverage, including runs whose analysis status was `COMPLETED`.

Classification of the audit's 48 persisted Health Scores (all numeric 100):

| Count | Classification | Evidence and meaning |
|---:|---|---|
| 23 | **Formula-verified, limited-scope valid** | These were the audit's verified cases: independently recalculated Health Scores and Health API values matched. Analysis completed without a vulnerable-labelled positive control. This verifies the arithmetic for persisted signals, not vulnerability-freedom; overall health coverage is still `PARTIAL` because Dependency and Reliability are unavailable. |
| 5 | **Formula-reproducing but security-misleading / unverified** | These completed vulnerable-labelled TypeScript/JavaScript cases had Security 100 because no finding was emitted. Four are the fallback cases addressed by this patch; the fifth, `case_031`, still has an unsupported source-boundary pattern. The original 100s remain historical and were not rewritten or re-audited. |
| 15 | **Security-unverified; 100 from remaining dimensions only** | Security was null and available weight was 45 (Quality 25 plus Maintainability 20). This group includes the six Python vulnerable-labelled cases and nine other partial analyzer/parser cases. The numeric mean is correct for the available dimensions but is not a security score. |
| 5 | **Upstream-incomplete / unverified despite 100 available weight** | `case_010_python_syntax_error`, `case_037_java_sqli`, `case_038_java_safe`, `case_039_cpp_sqli`, and `case_040_cpp_safe`. The run-level completeness predicate found parser diagnostics or failed repository intelligence even though the saved dimension inputs were 100. These values do not certify complete analysis. |

These counts reconcile with the saved totals: 28 completed, 20 partial, 23 verified, and 25 unverified. All 48 Health formula/API comparisons matched; Risk comparisons were **0**, because none of those runs had a persisted Risk Assessment. Risk scores for the original 48 must therefore be treated as **not applicable/unverified**, not as zero.

## Frontend communication

The detailed Health page already displays snapshot coverage and warns that 100 does not mean vulnerability-free ([health/page.tsx:38, 47-48](../src/app/health/page.tsx#L38)). The repository detail view also shows the coverage status ([repositories/[id]/page.tsx:163](../src/app/repositories/%5Bid%5D/page.tsx#L163)). The dashboard metric and repository list previously showed numeric scores without nearby coverage context. I updated the dashboard Health metric to include its coverage value ([dashboard/page.tsx:42-46](../src/app/dashboard/page.tsx#L42)) and added a coverage badge beside the repository-list score ([repositories/page.tsx:132-138](../src/app/repositories/page.tsx#L132)). No score formula or score threshold was changed.

## Fixes and validation

**Fixes made**

* `worker/src/analyzers/security/sql-injection-analyzer.ts`: preserve taint by evaluating and combining both sides of TypeScript `||` and `??` fallback expressions.
* `worker/tests/security-sql-injection.test.ts`: add a focused regression test for JavaScript logical-OR and TypeScript nullish fallback flows, asserting a finding and completed analyzer status.
* `src/app/dashboard/page.tsx` and `src/app/repositories/page.tsx`: display Health coverage in summary surfaces.
* This report documents the saved audit evidence and the single real post-fix verification.

No Health Score or Risk Score formula was changed. No fixture labels or expected statuses were changed. No mock result was used as evidence. The full 48-case fixture was not rerun.

**Validation**

* Focused SQL injection analyzer tests: 21 passed (including both new fallback regressions).
* Worker TypeScript typecheck: passed.
* API, database, contracts, and config workspace TypeScript checks: passed.
* ESLint for the dashboard and repository list pages: passed; editor diagnostics for both files: no errors.
* `git diff --check`: passed.
* One real post-fix end-to-end verification for `case_017_ts_sqli_concat`: completed with one finding, one evidence snapshot, one persisted Risk Assessment, zero risk persistence failures; persisted Risk Score 80 independently recalculated to 80; persisted Health Score 91 independently recalculated to 91.
* The aggregate root `pnpm typecheck` was also attempted, but its root `tsc` step includes the fixture's intentionally invalid TypeScript sources and stops on syntax diagnostics in `case_024_ts_syntax_error.ts` and `case_032_ts_incomplete.ts`. The package checks were run separately and passed; the fixture files were not changed.

## Remaining blockers and scope limits

* The 48-case audit is historical and has not been rerun. Only `case_017` was rerun after the taint fix; do not treat the other three fallback cases as batch-verified.
* `case_031_ts_sqli_double_concat` still needs a deliberate source-boundary policy for untrusted function parameters and regression tests. No broad tainting rule was introduced.
* The six Python positive controls remain unsupported by the current SQL analyzer expression subset; they explicitly produce `PARTIAL`. The syntax in those cases, including `.get(...)`, f-strings, multiline construction, and nested-helper flow, still needs implementation and tests before those cases can verify risk persistence.
* Java/C++ intelligence failures and incomplete/syntax-error inputs remain upstream coverage blockers for the five listed cases.
* The successful real Risk Score check covers one supported SQL injection finding only. Its API-returned Risk Score was not captured. The original audit's Risk Scores and their API comparisons remain unverified.
* Dependency and Reliability health dimensions are unavailable, so overall health coverage remains `PARTIAL` even on an otherwise completed pipeline run.

## Post-fix verification and full audit (2026-10-10)

The confirmed implementation changes since the preceding investigation were limited to:

* Preserve taint through TypeScript/JavaScript `??` and `||`, and explicitly report `PARTIAL`/`UNRESOLVED_SOURCE` when dynamic SQL reaches a sink through a function parameter whose input boundary cannot be proven. Existing imported-helper and CommonJS positive tests remain green.
* Extend the existing bounded Python subset to recognize `.get(...)` request sources, simple `str(variable)` SQL concatenation, returned parameterized `execute` calls, and returned constant SQL. This made the two simple Python positive controls (`case_001`, `case_043`) and safe negative controls (`case_003`, `case_004`, `case_044`) correctly analyzable without broadening to f-strings, multiline/multi-concat, or nested helper flow.
* Add an authenticated live end-to-end integration test using the real `case_017` source persisted in a LOCAL repository snapshot. The test verifies source ingestion, parser/Code IR persistence, deterministic finding and evidence graph, persisted Risk Assessment and Health snapshot, authenticated finding Risk API value, and independent recalculation. The verified case had persisted/independent/API Risk Score **80**, and persisted/independent/API Health Score **91**.
* Expose linked analysis-run status on each authenticated health-history entry. Dashboard, repository list, repository detail, and Health history now distinguish run status from snapshot coverage, label PARTIAL numeric scores as based on available dimensions only, and show unavailable scores without substituting a number.

The complete post-fix batch was run through the actual authenticated API, dedicated Redis/BullMQ queue, real worker, PostgreSQL repositories, and independent repository/commit per fixture. Sources and `labels.json` were not changed. A first full execution identified safe Python return-call forms that were conservatively marked partial; those forms received focused recognition and regressions, and the full 48-case batch was rerun. The delivered result files represent that final batch; **96** fixture-run executions occurred across the two post-fix full batches.

Final batch totals: **48/48 jobs terminal and completed**, **31** analysis runs `COMPLETED`, **17** `PARTIAL`, and zero `FAILED`/`DEAD_LETTER`; **5 detected**, **4 correctly safe**, **39 unsupported/partial or outside-contract cases**, **0 missed detections for the strict `VULNERABLE_SQLI` positive controls**, **0 persistence failures**, and **0 unverified cases**. All 48 persisted Health Scores independently recalculated exactly and matched the authenticated Health API. All **5** persisted Risk Assessments independently recalculated exactly and matched the authenticated Risk API. Missing assessments were not assigned a zero Risk Score.

The six vulnerable-labelled cases that remain explicitly unsupported/partial are `case_002_python_sqli_fstring`, `case_012_python_sqli_execute_variable`, `case_013_python_sqli_multiline`, `case_026_ts_sqli_concat_variable`, `case_031_ts_sqli_double_concat`, and `case_041_python_nested_sqli`. The first, second, third, and sixth remain outside the current bounded Python expression/interprocedural subset. `case_026` and `case_031` have explicit unproven function-parameter source-boundary diagnostics; no broad parameter taint was introduced. The fixture labels qualified as `VULNERABLE_OR_RULE_LIMIT` are reported as unsupported/partial rather than as confirmed detections or strict-label misses.

Health formula and inputs were not changed to force a different result. Forty-three final persisted Health Scores are 100, including partial runs whose scored dimensions yield 100; they are mathematically faithful to persisted available inputs, but the UI now explicitly shows partial coverage and run status so they cannot be mistaken for a complete security certification. The five supported vulnerable detections each yielded Risk Score 80 and Health Score 91. The 4 exact `SAFE_SQL` controls had no findings; three Python controls were complete after the focused Python adjustment and the TypeScript safe control remained complete. Other baseline/non-SQL cases remain explicitly unsupported, deferred, or partial according to their analyzer and parser coverage.

Final validation: focused SQL Injection suite **25/25**; full worker suite **121/121**; API integration/unit suite **34 passed, 0 failed** (2 live-gated tests skipped); database suite **2/2**; live SQL injection integration **1/1**; API, worker, database, contracts, and config package typechecks passed; affected frontend files typechecked; Next frontend lint passed; and `git diff --check` passed. The root aggregate typecheck remains unsuitable because its root `tsc` includes deliberately invalid fixture source files; package checks are the relevant successful checks. Dependency and Reliability dimensions remain unavailable by design, so overall Health coverage remains PARTIAL even for completed analysis runs.
