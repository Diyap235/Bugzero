# BugZero workers workspace

This package implements the PostgreSQL-backed analysis-job worker for deterministic analysis. Run it with `pnpm --dir worker start` after setting `DATABASE_URL`, `DATABASE_QUEUE_URL`, `DATABASE_QUEUE_LOCK_URL`, and applying the SQL migrations in numeric order. `DATABASE_QUEUE_URL` is the pooled connection used for ordinary queue queries. `DATABASE_QUEUE_LOCK_URL` must be a direct, unpooled URL for the same Neon project/branch endpoint and database, using the same dedicated `bugzero_queue_worker` role. Session-level advisory locks require a stable PostgreSQL session; a transaction pooler can route consecutive lock and unlock calls to different server sessions. The worker validates the endpoint/database/role pairing and checks the connected PostgreSQL role's `BYPASSRLS` attribute with a read-only role query before claiming work.

The worker role must have only `SELECT` and `UPDATE` privileges on `analysis_jobs`; migration 0014 grants these privileges if that role exists when it is applied. The queue policy authorizes cross-tenant claims only for that database login. The API creates `analysis_runs` and `analysis_jobs` in one PostgreSQL transaction. Workers claim jobs with `FOR UPDATE SKIP LOCKED`, persisted leases, bounded retries, and lease-fenced status updates. If finalizing an exhausted job's run fails, the queue returns that expired lease for finalization retry before claiming another job.

For a one-shot execution restricted to a single existing job and its organization,
run:

```powershell
pnpm --dir worker exec node --env-file-if-exists=../.env.local --import tsx src/worker.ts --job-id <job-uuid> --organization-id <organization-uuid>
```

Both UUIDs are required in single-job mode. The scoped mode limits expired-lease
cleanup and job claiming to that exact job and organization, verifies the
claimed job and its analysis run through tenant-scoped application queries, then
exits after one claim or when the target is not eligible. The regular
`pnpm --dir worker start` command remains a global queue worker.

## Intended responsibilities

- atomically claiming durable PostgreSQL analysis jobs and loading their runs
- parsing commit source, persisting Code IR, building Repository Intelligence, deriving scope, and invoking the analyzer orchestrator
- recording analyzer metrics, diagnostics, and run completion in existing analysis-run coverage
- retry-safe finding identity, occurrence persistence, and run-scoped PostgreSQL Code IR upserts

## Current state

The worker executes deterministic quality and currently implemented SQL Injection security analysis, persists Evidence/Risk/Health, then optionally requests an advisory NVIDIA repository review. The review receives bounded, redacted source files and dependency manifests from the commit. `NVIDIA_API_KEY` and optional `NVIDIA_MODEL` are read only by the worker; the default model is `openai/gpt-oss-20b`. Use a currently available NVIDIA model ID when overriding it. Provider HTTP status is recorded without response bodies, credentials, or repository source so unavailable/retired models can be diagnosed. AI estimates and suggestions are persisted separately and cannot create, confirm, dismiss, or change deterministic findings.

Security coverage is incomplete: the deterministic security analyzer currently covers SQL Injection only. Dependencies are not scanned against a vulnerability/advisory database; advisory dependency estimates report manifest hygiene only. Reliability has no deterministic score yet and uses a cited, advisory-only source rubric. Health snapshots record actual parser-inspected files and exact reviewer input-file coverage rather than an AI-generated coverage value.

## Investigative ML signal

After deterministic findings, evidence, risk, and health have been produced, the
worker may score in-scope Python function/method source through the isolated
`ml/inference/predict.py` process boundary. Functions are sent individually with
a 64 KiB UTF-8 limit; duplicate source within the analysis is inferred once.
Signals are stored only under `analysis_runs.coverage.pipeline.mlSignals` and
contain function reference, model version, label, score, and timestamp. They are
not Findings or Evidence and cannot affect deterministic risk or run completion.

Each worker keeps one serialized JSONL inference process for its lifetime and
warms the model before claiming jobs. This keeps Python, CodeBERT, and artifact
loading out of each repository's analysis time; model initialization instead
affects worker readiness after startup.

If the interpreter, artifact, model download, or inference is unavailable, the
coverage records `mlSignals.status = "UNAVAILABLE"` and deterministic analysis
continues. Install `ml/requirements.txt` in the worker's Python environment and
set `BUGZERO_ML_PYTHON` when its interpreter is not available as `python`.
