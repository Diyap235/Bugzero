# BugZero system design

## Architecture

BugZero uses TypeScript for API orchestration, contracts, authorization, persistence integration, and worker lifecycle. Python is reserved for parsing or code-intelligence components where supported by the existing stack. Neon PostgreSQL is the sole runtime database and queue: it stores tenant-owned product and analysis records, run-scoped code intelligence, and durable worker jobs. The existing frontend, authentication, organization isolation, and repository onboarding remain in place.

```text
Repository snapshot / indexed commit
  -> PostgreSQL analysis_runs + analysis_jobs (one transaction)
  -> atomic PostgreSQL worker claim (SKIP LOCKED + lease token)
  -> parsing and semantic code representation
  -> tenant/run-scoped PostgreSQL entities, relationships, dependencies, data-flow edges
  -> deterministic analyzers and evidence validation
  -> findings + occurrences + evidence
  -> deterministic risk and health calculations
  -> persisted PostgreSQL records
  -> authenticated API and existing UI
```

## Queue guarantees

The API's committed `analysis_jobs` row is the durable enqueue operation. Workers claim one eligible job in a transaction with `FOR UPDATE SKIP LOCKED`, increment its persisted attempt count, and assign an expiring lease. Heartbeats extend the lease; worker status updates are fenced by its lease owner. Failed jobs become `RETRY` with bounded exponential delay until `max_attempts`, then become `DEAD_LETTER`. Expired leases are reclaimed or dead-lettered. Processing happens under the job's organization context; only queue discovery uses the worker-only RLS policy.

## Code intelligence

`code_entities`, `code_relationships`, `dependencies`, `dependency_edges`, and `data_flow_edges` are tenant-scoped PostgreSQL tables. New records are run-scoped and idempotent on deterministic identities. The forward-only migration `0014_postgres_queue_and_code_graph.sql` adds run keys/indexes and the data-flow table while leaving historical rows associated with `analysis_run_id = NULL`. Graph read/write failures fail the affected stage; there is no successful fallback when persistence fails.

## Authority and coverage

Deterministic analyzers and validated source/evidence are the only source of authoritative findings. ML output is an investigative signal. AI output is an advisory explanation and cannot create or change findings, evidence authority, risk, or health. Parsing limits, unsupported languages, missing graph links, and incomplete evidence remain visible as partial or failed analysis; they are never treated as proof of safety.

PostgreSQL migrations are forward-only. Do not run a migration against an unverified or production database as part of local development. Migration `0014` and the replacement queue/graph implementations require database-backed validation and full end-to-end acceptance before being treated as production-ready.

## Related specifications

- [Architecture](./ARCHITECTURE.md)
- [Database design](./DATABASE_DESIGN.md)
- [API](./API.md)
- [Code IR](./CODE_IR.md)
- [Analyzer behavior](./ANALYZERS.md)
- [Risk formula](./RISK.md)
- [Health formula](./HEALTH.md)
