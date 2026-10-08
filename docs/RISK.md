# Deterministic Risk Engine v1

## Status and boundary

**IMPLEMENTED (deterministic, profile-versioned, evidence-aware; live database behavior verified 2026-10-08).** The worker calculates risk after an occurrence and its immutable evidence snapshot have been persisted. The engine does not change finding identity, severity, confidence, lifecycle, business priority, accepted-risk, exceptions, or human disposition. It updates only the finding's `current_risk` projection after persisting the immutable assessment.

The assessment is a technical prioritization score, not a probability, business-impact estimate, exploitability claim, or replacement for severity. Reachability and exploitability remain `UNKNOWN` unless explicitly supplied as known dimensions. Dependency exposure remains `UNKNOWN`, and affected-module count remains unavailable; neither is scored.

## Default profile

The bundled `default-v1` profile uses model version `bugzero-deterministic-risk-v1`. It computes an integer score by adding the following values, then clamps the total to 0–100:

| Factor | Values and score adjustments |
|---|---|
| Severity base | INFO 0; LOW 20; MEDIUM 40; HIGH 60; CRITICAL 80 |
| Confidence | LOW -10; MEDIUM 0; HIGH +5 |
| Evidence strength | UNKNOWN 0; LOW -10; MEDIUM 0; HIGH +5 |
| Evidence authority | AUTHORITATIVE 0; INVESTIGATIVE -5; UNKNOWN 0 |
| Evidence sufficiency | SUFFICIENT +5; INSUFFICIENT -5; UNKNOWN 0 |
| Evidence completeness | COMPLETE +5; PARTIAL -5; INCOMPLETE -10 |
| Reachability | UNKNOWN 0; LOW -5; MEDIUM 0; HIGH +5 |
| Exploitability | UNKNOWN 0; LOW -5; MEDIUM 0; HIGH +5 |
| Dependency exposure | UNKNOWN; unavailable and unscored |
| Affected-module count | unavailable and unscored |

Band thresholds are INFO 0–9, LOW 10–29, MEDIUM 30–54, HIGH 55–79, and CRITICAL 80–100. Each assessment stores the profile and model versions, profile snapshot, per-factor values/adjustments, raw and bounded scores, band, and a deterministic explanation.

Incomplete or partial evidence cannot be treated as `SUFFICIENT` by the risk engine. If a caller supplies `SUFFICIENT` with non-COMPLETE evidence, the assessment records sufficiency as `UNKNOWN`; it does not receive the positive sufficiency adjustment. This scoring safeguard does not make incomplete evidence authoritative or establish a vulnerability.

## Persistence, replay, and failures

Migration `0006_deterministic_risk_assessments.sql` creates immutable risk-assessment records linked by composite foreign keys to a finding, occurrence, evidence snapshot, repository, commit, and analysis run. The uniqueness key is organization + occurrence + profile ID + profile version. Replaying the same occurrence/profile version reuses the assessment; a new commit occurrence gets a new assessment and does not update historical assessments. The finding's current-risk field is a mutable projection, not the historical record.

Risk persistence happens after evidence persistence. If assessment persistence fails, the finding and evidence are retained, the current-risk projection is not advanced, the analyzer result is marked `PARTIAL`, and a diagnostic/failure metric is emitted. If the assessment persists but the current-risk projection fails, the historical assessment is retained and the analyzer result is marked `PARTIAL`. The implementation does not silently substitute a successful assessment.

## Validation and limitations

Worker tests cover factor adjustments and bounds, all band boundaries, invalid inputs/profiles, unknown and incomplete evidence, SQL Injection evidence-to-assessment linkage, replay/idempotency, new-commit history, preservation of human disposition, and risk persistence failure isolation. Migration tests inspect the versioned assessment schema and immutability/idempotency constraints. These tests use in-memory adapters for repository behavior; they do not validate live PostgreSQL constraints or trigger execution.

This v1 does not score business priority, dependency vulnerabilities, exploit probability, reachability inferred from a finding, repository-wide blast radius, or AI-generated judgments. Live migration execution and PostgreSQL/Redis/Docker integration have not been verified.

Repository-level health aggregates persisted risk assessments with findings and evidence. It does not alter this finding-level score or recalculate risk; see [HEALTH.md](HEALTH.md).
