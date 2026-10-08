# ADR-009 — Progressive Large-Repository Analysis

- **Status:** Accepted
- **Date:** 2026-10-07
- **Decision:** Large repositories use progressive initial analysis followed by continuous incremental intelligence.

## Context
A 1M+ LOC repository should become useful before every deep analyzer has finished, while incomplete analysis must never masquerade as complete.

## Decision
Initial analysis proceeds through ingestion, rapid structural intelligence, high-confidence fast findings, and background deep analysis. Users may explore available intelligence while deeper capabilities are running.

Each capability reports its own status. Findings are surfaced only when the relevant analyzer has completed sufficiently for that conclusion. Coverage and completeness are explicit and separate from finding confidence and severity.

The architecture targets 1M+ LOC but does not claim performance until benchmark stages at 10K, 100K, 500K, and 1M LOC are measured.

## Consequences
- Better time-to-first-value.
- More complex UI/API status semantics.
- Benchmarks become part of the definition of scale claims.
