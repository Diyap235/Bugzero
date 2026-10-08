# ADR-008 — Incremental and Impact-Based Analysis

- **Status:** Accepted
- **Date:** 2026-10-07
- **Decision:** Changed LOC and affected LOC are separate concepts; analysis scope is selected through impact analysis.

## Context
Reanalyzing a whole repository for every commit does not scale. An edited function may affect callers, data-flow paths, dependencies, or security-sensitive boundaries elsewhere.

## Decision
Start from the changed files/symbols, resolve repository relationships, expand to affected scope, and run the minimum safe computation required for each analyzer. Uncertainty that can materially affect a conclusion triggers scope expansion.

PR analysis is the hot path: diff → impact analysis → targeted analysis → PR result. Deep repository analysis is the cold path and may continue asynchronously.

## Consequences
- Lower latency for routine changes.
- Requires persistent relationship indexes and versioned snapshots.
- Incorrect impact resolution can cause unsafe omissions, so unresolved relationships must be represented explicitly.
