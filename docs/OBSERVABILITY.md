# Observability model

## Status

Observation and tracing are architectural concerns in the BugZero design. The repository includes ADRs and design language around observability, but not a completed telemetry implementation.

## Architecture intent

The design calls for structured logging, traceability across analysis jobs, and a clear separation between system state and technical findings. The ADRs describe observability as a necessary operational layer for repository analysis, failure handling, and job progress tracking.

## The expected model

- job-level execution state
- analysis stage visibility
- failure and retry tracking
- correlation between analysis runs and generated evidence
- traceable repository and commit context

## Current state

Analysis request and queue failures use Fastify structured logs with run/job IDs and error class only; credentials, raw source, and queue error text are not logged by the API route. Accepted requests log run ID, job ID, whether work was reused, and enqueue state.

The worker logs BullMQ failure/error events. The analysis processor records parser diagnostics, parse/IR counts, stage timing, scope/impact information, per-analyzer status/metrics, findings count, and terminal pipeline status in the existing `analysis_runs.coverage` JSON. `GET /analysis/:runId` exposes this stored progress plus the current job stage/status/attempt/timestamps and a sanitized failure indicator.

No centralized tracing, metrics backend, or live deployment integration is present; those remain PARTIAL/PLANNED.
