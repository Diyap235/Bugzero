# BugZero workers workspace

This package implements the Redis + BullMQ analysis-job worker for deterministic Structural/Quality analysis. Run it with `pnpm --filter @bugzero/workers start` after setting `REDIS_URL` and applying the SQL migrations in numeric order. The API creates the existing `analysis_runs` and `analysis_jobs` records, then enqueues the canonical `{ organizationId, jobId }` payload with the shared `enqueueAnalysisJob` helper.

## Intended responsibilities

- consuming the single BullMQ analysis queue and loading existing analysis jobs/runs
- parsing commit source, persisting Code IR, building Repository Intelligence, deriving scope, and invoking the analyzer orchestrator
- recording analyzer metrics, diagnostics, and run completion in existing analysis-run coverage
- retry-safe finding identity, occurrence persistence, and Code IR relationship upserts

## Current state

The worker executes the implemented deterministic quality stage. Security, dependency CVEs, evidence graph, risk, and AI stages are not run by this worker.

## Investigative ML signal

After deterministic findings, evidence, risk, and health have been produced, the
worker may score in-scope Python function/method source through the isolated
`ml/inference/predict.py` process boundary. Functions are sent individually with
a 64 KiB UTF-8 limit; duplicate source within the analysis is inferred once.
Signals are stored only under `analysis_runs.coverage.pipeline.mlSignals` and
contain function reference, model version, label, score, and timestamp. They are
not Findings or Evidence and cannot affect deterministic risk or run completion.

If the interpreter, artifact, model download, or inference is unavailable, the
coverage records `mlSignals.status = "UNAVAILABLE"` and deterministic analysis
continues. Install `ml/requirements.txt` in the worker's Python environment and
set `BUGZERO_ML_PYTHON` when its interpreter is not available as `python`.
