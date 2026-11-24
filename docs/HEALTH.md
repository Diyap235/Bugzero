# Repository Health v1

## Purpose and implementation status

**IMPLEMENTED:** deterministic repository-level aggregation after finding, evidence, and risk persistence. Health is an immutable repository/revision observation; it is not another analyzer. It consumes persisted Finding rule identity, FindingOccurrence severity/confidence and identity, Evidence snapshot authority/completeness, and Risk Assessment technical score/band. It never re-runs a finding rule or recomputes finding risk.

Health does not change finding severity, lifecycle, reviewer decisions, business priority, accepted-risk, exceptions, or disposition. Analysis outputs survive a health calculation or persistence failure; the run is reported `PARTIAL`, the health result is `FAILED`, and no health snapshot is written.

```text
Findings -> Evidence -> Risk -> Repository Health Snapshot
```

## Dimensions and current coverage

| Dimension | Inputs in v1 | Status |
|---|---|---|
| Security | Security findings, severity, persisted technical risk/band, evidence authority/completeness | IMPLEMENTED for completed security analyzers, including SQL Injection |
| Quality | Structural/quality findings and persisted technical risk | IMPLEMENTED for produced Structural/Quality findings |
| Maintainability | `LONG_FUNCTION`, `HIGH_PARAMETER_COUNT`, `HIGH_FAN_OUT`, `HIGH_FAN_IN` findings and persisted technical risk | IMPLEMENTED from the same `STRUCTURAL` analyzer result; a separate `QUALITY` analyzer does not imply Maintainability coverage |
| Dependencies | Separately stored advisory estimate based on supplied dependency manifests and lockfiles | Deterministic score UNKNOWN; a non-null estimate requires manifest citations. This is manifest hygiene, not CVE or freshness analysis |
| Reliability | Separately stored advisory estimate based on concrete source-level reliability controls | Deterministic score UNKNOWN; a non-null estimate requires valid source citations |

`EMPTY_FUNCTION` and other non-security, non-maintainability findings contribute to Quality. The Quality aggregate includes the maintainability subset as part of the complete structural/quality finding set. Maintainability provides a separate focused view over the listed structural rule IDs. No duplicate detection rules are added.

LOC and findings-per-1,000-LOC are unavailable. The pipeline counts source and parsed files, but does not currently produce a reliable repository LOC metric. Zero LOC is therefore never used as a denominator and the missing density metric is stored as `null`.

## Versioned score model

The `default-v1` profile (`bugzero-deterministic-health-v1`) is stored with each snapshot. Dimension weights are Security 55, Quality 25, Maintainability 20. Weights sum to 100. Each dimension is assessed independently using its own analyzer coverage and relevant upstream completeness. A partial or unavailable dimension does not prevent another complete dimension from receiving a score.

Security health reflects findings from the security analyzers currently implemented (currently SQL injection only). A score of 100 means those analyzers produced no findings for the run; it does not mean the repository is vulnerability-free. Unsupported vulnerability classes are not included in the score.

```text
dimensionPenalty =
  sum(severityPenalty[dimension][finding.severity]
      * persistedTechnicalRisk / riskScale)

dimensionScore = round(clamp(100 - dimensionPenalty, 0, 100))

overallScore =
  round(sum(scoredDimensionScore * configuredWeight)
        / sum(weights for dimensions with valid scores))

  when at least one score-bearing dimension has valid evidence;
  included dimensions, excluded dimensions, and weights are persisted separately
```

When every configured score-bearing dimension is complete, the denominator is the full configured weight (100). For partial assessment, unavailable dimensions are excluded from the denominator and listed with their weights and reasons; the resulting number is explicitly provisional and overall status remains `PARTIAL`. This is not a full-repository score. `riskScale` is 100. The health layer uses the already-persisted Risk Assessment; it does not change or rerun its calculation.

The deterministic `score` and overall score remain authoritative and are never replaced by AI output. Optional worker-side review stores separate `estimatedScore`, confidence, explanation, citations, and advisory suggestions on each dimension. The combined health estimate uses Security 35%, Quality 20%, Maintainability 15%, Reliability 15%, and Dependencies 15%; a deterministic dimension score is used where available, otherwise a cited AI estimate is used. Weights are renormalized over evidence-backed values. The combined estimate is therefore explicitly a mixture when both verified and estimated dimensions are present, not an AI-only score.

AI reliability estimates award up to 20 points each for directly cited evidence of bounded timeouts/deadlines, bounded retries/backoff, explicit error propagation or recovery, safe cleanup/cancellation/resource lifecycle, and idempotent or transactional side-effect handling. Missing controls are not inferred from partial excerpts; insufficient evidence produces `null`.

AI dependency estimates assess manifest hygiene only: up to 25 points each for a supplied parseable dependency inventory, a supplied reproducible lockfile, constrained rather than wildcard/tag-only versions, and separation of runtime from development dependencies where supported. Citations must resolve to supplied manifests/lockfiles. Without an advisory feed and version evidence, estimates do not assert that dependencies are current or vulnerability-free. If review is unavailable, malformed, uncited, or fails, the estimate remains null and deterministic snapshots remain available.

For each persisted estimate, `estimateCoverage` records the exact number of source files and dependency manifests supplied to the reviewer. Source coverage is computed from those file counts, never generated by the model. Separately, `calculation.sourceFileCoverage` records the number of source files actually passed through a supported parser against source files supplied to the analysis. Neither metric claims whole-repository coverage beyond the files available to that run.

| Severity | Security penalty | Quality penalty | Maintainability penalty |
|---|---:|---:|---:|
| INFO | 1 | 1 | 1 |
| LOW | 5 | 3 | 4 |
| MEDIUM | 10 | 7 | 8 |
| HIGH | 20 | 12 | 15 |
| CRITICAL | 35 | 20 | 25 |

Penalties are scaled proportionally by each finding's technical risk. For example, one HIGH security finding with risk 80 contributes `20 * 80 / 100 = 16` penalty points. A missing persisted risk assessment makes that dimension's score `null` rather than silently excluding the finding.

Dimension scores map to health bands as follows: 90–100 EXCELLENT, 75–89 GOOD, 60–74 FAIR, 40–59 POOR, and 0–39 CRITICAL. Overall status is `PARTIAL` whenever configured score-bearing coverage is partial, even when a provisional numeric score is available; `calculation.overallScoreBand` preserves the band for that number. With complete coverage, overall status is the score band.

Each dimension stores score, status, coverage, evidence coverage confidence where there are findings, counts by severity, high-risk finding count, total technical risk, source/parsed file counts, unavailable LOC metrics, and a deterministic explanation. Confidence is the percentage of that dimension's findings with AUTHORITATIVE, COMPLETE evidence; it is `null` when there are no findings.

## Unknown, partial, and coverage semantics

- **UNKNOWN:** the dimension's analyzer/signals are unavailable; its score and confidence are `null`. Missing data is never converted to 0 or 100.
- **PARTIAL:** the analysis scope, a relevant analyzer, upstream evidence, or an expected persisted risk assessment is incomplete. A dimension score is retained only where findings provide evaluated persisted risk; otherwise that dimension score is `null`. An overall provisional score may use available score-bearing dimensions, with excluded dimensions and weights reported explicitly.
- **COMPLETE:** the dimension's analyzer completed successfully.

Overall health coverage considers only positively weighted score-bearing dimensions. It is COMPLETE when all of those dimensions have complete evidence from a `REPOSITORY`-scope run. It is UNKNOWN when all score-bearing dimensions are UNKNOWN and none has scored data; otherwise incomplete or unavailable score-bearing dimensions make coverage PARTIAL. Dependency and Reliability remain UNKNOWN but are not configured as score-bearing dimensions in v1, so they do not invalidate otherwise complete Security, Quality, and Maintainability scores. `COMMIT`, changed-file, and other limited scopes cannot claim full-repository coverage.

The authenticated health-history API includes the status of the analysis run linked to each snapshot and returns estimate confidence, citations, and source/manifest input coverage with the persisted dimension. Dashboard, repository, and Health views show verified scores separately from AI estimates; advisory suggestions include cited file locations and are not presented as verified findings. A provisional numeric score with PARTIAL coverage is labeled `PARTIAL`; a null overall score is shown as unavailable rather than replaced with a numeric value.

## Snapshot persistence, history, and idempotency

The existing `health_snapshots` table and `HealthRepository` are extended; no duplicate health table is introduced. Migration `0007_repository_health_v1.sql` adds analysis-run and profile/model identity, overall score/status, coverage, dimensions, profile/calculation snapshots, and deterministic explanation. New snapshots are linked by a composite foreign key to their exact run/repository/commit. Legacy score columns become nullable to represent unavailable dimensions. The existing immutability trigger continues to protect snapshots.

Each v1 snapshot links to its analysis run and exact repository revision. The idempotency key is organization + repository + commit + health profile ID + health profile version. Replaying the same revision/profile returns the existing snapshot. A new commit creates a new snapshot and preserves prior history for future trend comparison. Profile/model and calculation metadata are persisted so later trend features can compare snapshots without altering old assessments.

## Validation and limitations

Worker tests cover empty/no-finding inputs, Security/Quality/Maintainability aggregation, severity and risk effects, partial/unrun analyzers, unknown deterministic dependencies, missing risk, zero/unavailable LOC, critical and multiple findings, deterministic explanations, profile versions, all score boundaries, finite-score behavior, persistence idempotency, new-commit history, migration structure, NVIDIA source/manifest context and separate estimates, and the Analysis Job -> Parser -> Code IR -> Repository Intelligence -> Analyzer Orchestrator -> SQL Injection -> Finding -> Evidence -> Risk -> Health path.

Repository tests use in-memory adapters for persistence behavior. Migration definitions are tested. The PostgreSQL-only queue and run-scoped graph migration require fresh disposable-database verification before production use. Deterministic dependency vulnerability analysis and deterministic reliability signals remain **PLANNED/UNAVAILABLE**; any AI estimates are advisory and do not change these deterministic capability statuses.
