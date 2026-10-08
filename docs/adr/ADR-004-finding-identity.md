# ADR-004 — Hybrid Semantic Finding Identity

- **Status:** Accepted
- **Date:** 2026-10-07
- **Decision:** A Finding represents an underlying issue; Occurrences represent observations at specific revisions.

## Context
File/line identity breaks under refactors, moves, and line shifts, while source hashes alone cannot reliably establish semantic continuity.

## Decision
Finding identity uses a hybrid semantic fingerprint composed from rule, semantic target, relevant relationships/evidence, normalized code fingerprint, history, and repository context.

Matching outcomes are SAME, NEW, or UNKNOWN. UNKNOWN must not silently merge findings.

Historical occurrences are immutable. The current Finding stores a derived projection of the latest relevant occurrence.

Finding lifecycle: OPEN, CONFIRMED, IN_PROGRESS, RESOLVED, DISMISSED, REOPENED.
Observation state is separate: DETECTED, NOT_DETECTED, PARTIALLY_ANALYZED, ANALYSIS_INCOMPLETE, ANALYSIS_FAILED, NOT_APPLICABLE.

NOT_DETECTED never means RESOLVED. Resolution requires successful sufficiently complete analysis proving the condition is gone.

## Consequences
- Finding history survives refactors.
- Matching is more complex and must be conservative.
- Human disposition remains separate from machine evidence.
