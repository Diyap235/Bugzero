# Finding model

## Persistence integration

The worker uses the existing finding schema and repository:

`Rule -> FindingCandidate -> normalization -> FindingRepository.createOrGet -> FindingRepository.createOccurrenceIfAbsent -> Finding / FindingOccurrence`

A `Finding` is stable identity, keyed by organization/repository/rule/semantic identity including analyzer and rule versions. The database ID is created once and reused for later detections. Each distinct commit produces a separate immutable observation; normalized replay identity includes organization, repository, commit, profile/version, analyzer/version, rule/version, and scope.

Migration `0003_finding_occurrence_idempotency.sql` adds a unique index on `(organization_id, finding_id, commit_id, normalized_fingerprint)`. Migration `0004_code_relationship_idempotency.sql` adds the unique key required for safe Code IR relationship upserts. Migration `0005_versioned_evidence_graph.sql` adds occurrence-scoped evidence identity, completeness/diagnostics, and node source ranges to the existing evidence tables. Migration `0006_deterministic_risk_assessments.sql` adds immutable profile-versioned risk assessments and explicit `UNKNOWN` occurrence dimensions. Migration `0007_repository_health_v1.sql` extends the existing immutable health snapshots with profile identity, dimension coverage, scores, and calculation provenance. These migrations are additive; do not edit applied migration history. Apply all seven in numeric order with `pnpm --filter @bugzero/database migrate`; all seven have been applied against live PostgreSQL and verified idempotent (2026-10-08).

## Lifecycle and disposition

- `NOT_DETECTED` is an observation, not a lifecycle transition to `RESOLVED`.
- The analyzer emits `DETECTED` only. It does not manufacture absence evidence, mark a finding resolved, or set human disposition. Each detected occurrence is linked to one or more immutable evidence snapshots by finding ID and occurrence ID; evidence is not copied into the finding row.
- On identity match, repository persistence updates machine-owned severity, confidence, risk, and last-seen commit. It does not change lifecycle, accepted-risk, exception, or disposition fields.
- The Risk Engine writes an immutable assessment tied to the occurrence and its evidence snapshot. Its current-risk projection updates only `current_risk`; severity, confidence, lifecycle, and human disposition remain independent.
- Repository Health aggregates persisted evidence/risk with finding severity at the repository/revision level. Health snapshots are separate observations; they do not change finding lifecycle or reviewer disposition. Unsupported dimensions remain UNKNOWN and are not stored as numeric placeholders. See [HEALTH.md](HEALTH.md).
- Resolution requires authoritative, complete, sufficient evidence tied to a completed run and `NOT_DETECTED` occurrence; the database guard enforces this. The current Structural/Quality producer emits detection evidence only and does not resolve findings.

## Validation boundary

Worker tests exercise Finding → FindingOccurrence → Evidence Snapshot → Nodes/Edges/Paths → Risk Assessment → Repository Health with injected in-memory repositories and verify migration definitions. No live PostgreSQL instance was available, so migration application and actual constraint behavior have not been claimed as live-validated. See [EVIDENCE.md](EVIDENCE.md), [RISK.md](RISK.md), and [HEALTH.md](HEALTH.md).
