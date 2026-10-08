# ADR-006 — Redis + BullMQ Adaptive Analysis Jobs

- **Status:** Accepted
- **Date:** 2026-10-07
- **Decision:** Use Redis + BullMQ with adaptive hierarchical jobs and mandatory idempotency.

## Context
Large repository analysis cannot block API requests and must survive retries, partial failures, and worker scaling.

## Decision
Use job stages such as ingestion, parsing, Code IR, dependency/security/quality analysis, evidence, risk, and AI. Job granularity should be meaningful rather than one giant job or thousands of tiny jobs.

Every job is idempotent using repository, commit, analysis profile, analyzer version, and scope as identity inputs. Retries use exponential backoff and failure classification. Repeated failures enter a dead-letter state.

One analyzer failure must not automatically invalidate unrelated analyzer results.

## Consequences
- Safe retries and horizontal worker scaling.
- More explicit job-state management.
- Idempotency keys must be stable across worker restarts.
