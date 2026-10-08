# ADR-014 — OpenTelemetry-Centered Observability

- **Status:** Accepted
- **Date:** 2026-10-07
- **Decision:** Use OpenTelemetry-compatible traces/metrics plus structured logs across API, workers, analyzers, and AI.

## Context
Analysis is asynchronous and multi-stage; without correlation it is difficult to diagnose latency, partial failure, or resource pressure.

## Decision
Track repository/revision/analysis/job identifiers across stages. Required measurements include queue latency/depth, analysis duration, analyzer failures, parser failures, coverage/completeness, finding counts, CPU/memory, AI latency/cost, database/Redis latency, retries, and resource-limit failures.

## Consequences
- Better debugging and benchmark visibility.
- Telemetry schema must remain consistent across TypeScript and Python components.
