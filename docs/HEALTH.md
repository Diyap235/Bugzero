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
| Maintainability | `LONG_FUNCTION`, `HIGH_PARAMETER_COUNT`, `HIGH_FAN_OUT`, `HIGH_FAN_IN` findings and persisted technical risk | IMPLEMENTED from existing structural signals only |
| Dependencies | Dependency vulnerability findings | UNKNOWN; dependency vulnerability analysis is not implemented |
| Reliability | Deterministic reliability signals | UNKNOWN; no supported reliability signal is currently produced |

`EMPTY_FUNCTION` and other non-security, non-maintainability findings contribute to Quality. The Quality aggregate includes the maintainability subset as part of the complete structural/quality finding set. Maintainability provides a separate focused view over the listed structural rule IDs. No duplicate detection rules are added.

LOC and findings-per-1,000-LOC are unavailable. The pipeline counts source and parsed files, but does not currently produce a reliable repository LOC metric. Zero LOC is therefore never used as a denominator and the missing density metric is stored as `null`.

## Versioned score model

The `default-v1` profile (`bugzero-deterministic-health-v1`) is stored with each snapshot. Dimension weights are Security 55, Quality 25, Maintainability 20. Weights sum to 100. Only dimensions with a score participate; the weighted mean is renormalized by the sum of available dimension weights:

```text
dimensionPenalty =
  sum(severityPenalty[dimension][finding.severity]
      * persistedTechnicalRisk / riskScale)

dimensionScore = round(clamp(100 - dimensionPenalty, 0, 100))

overallScore =
  round(sum(scoredDimensionScore * configuredWeight)
        / sum(configuredWeight for scored dimensions))
```

`riskScale` is 100. The health layer uses the already-persisted Risk Assessment; it does not change or rerun its calculation.

| Severity | Security penalty | Quality penalty | Maintainability penalty |
|---|---:|---:|---:|
| INFO | 1 | 1 | 1 |
| LOW | 5 | 3 | 4 |
| MEDIUM | 10 | 7 | 8 |
| HIGH | 20 | 12 | 15 |
| CRITICAL | 35 | 20 | 25 |

Penalties are scaled proportionally by each finding's technical risk. For example, one HIGH security finding with risk 80 contributes `20 * 80 / 100 = 16` penalty points. A missing persisted risk assessment makes that dimension's score `null` rather than silently excluding the finding.

Scores map to statuses as follows: 90–100 EXCELLENT, 75–89 GOOD, 60–74 FAIR, 40–59 POOR, and 0–39 CRITICAL. Overall score/status and coverage are separate: a score may have a health band while its coverage is PARTIAL.

Each dimension stores score, status, coverage, evidence coverage confidence where there are findings, counts by severity, high-risk finding count, total technical risk, source/parsed file counts, unavailable LOC metrics, and a deterministic explanation. Confidence is the percentage of that dimension's findings with AUTHORITATIVE, COMPLETE evidence; it is `null` when there are no findings.

## Unknown, partial, and coverage semantics

- **UNKNOWN:** the dimension's analyzer/signals are unavailable; its score and confidence are `null`. Missing data is never converted to 0 or 100.
- **PARTIAL:** the analysis did not fully complete or an expected persisted risk assessment is missing. A score is retained only where findings provide evaluated persisted risk; otherwise the score is `null`.
- **COMPLETE:** the dimension's analyzer completed successfully.

Overall coverage is COMPLETE only when the analysis is full-scope and all dimensions have COMPLETE coverage. It is UNKNOWN if no dimension has scored data and every dimension is UNKNOWN; otherwise any unsupported, partial, or unknown dimension makes overall coverage PARTIAL. In v1, Dependency and Reliability are UNKNOWN and thus overall coverage is necessarily PARTIAL even when Security, Quality, and Maintainability analysis completed. This does not downgrade the numeric score or its score band.

## Snapshot persistence, history, and idempotency

The existing `health_snapshots` table and `HealthRepository` are extended; no duplicate health table is introduced. Migration `0007_repository_health_v1.sql` adds analysis-run and profile/model identity, overall score/status, coverage, dimensions, profile/calculation snapshots, and deterministic explanation. New snapshots are linked by a composite foreign key to their exact run/repository/commit. Legacy score columns become nullable to represent unavailable dimensions. The existing immutability trigger continues to protect snapshots.

Each v1 snapshot links to its analysis run and exact repository revision. The idempotency key is organization + repository + commit + health profile ID + health profile version. Replaying the same revision/profile returns the existing snapshot. A new commit creates a new snapshot and preserves prior history for future trend comparison. Profile/model and calculation metadata are persisted so later trend features can compare snapshots without altering old assessments.

## Validation and limitations

Worker tests cover empty/no-finding inputs, Security/Quality/Maintainability aggregation, severity and risk effects, partial/unrun analyzers, unknown dependencies, missing risk, zero/unavailable LOC, critical and multiple findings, deterministic explanations, profile versions, all score boundaries, finite-score behavior, persistence idempotency, new-commit history, migration structure, and the Analysis Job -> Parser -> Code IR -> Repository Intelligence -> Analyzer Orchestrator -> SQL Injection -> Finding -> Evidence -> Risk -> Health path.

Repository tests use in-memory adapters for persistence behavior. Migration definitions are tested. Live PostgreSQL constraints and trigger behavior have been verified against live PostgreSQL (2026-10-08) via the full E2E integration test. Redis/BullMQ live integration has also been verified end-to-end. Trend charts, API/UI exposure, dependency vulnerability analysis, and reliability signals are **PLANNED/UNAVAILABLE**.
