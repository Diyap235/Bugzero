# BugZero architecture

## Runtime flow

```text
Authenticated API
  -> tenant-scoped PostgreSQL transaction (analysis_run + analysis_job)
  -> PostgreSQL job queue (FOR UPDATE SKIP LOCKED, bounded attempts and leases)
  -> worker reads the exact indexed repository commit
  -> language adapters / run-scoped Code IR
  -> PostgreSQL code entities, relationships, dependencies and data-flow edges
  -> repository intelligence and deterministic analyzers
  -> evidence validation -> persisted findings and evidence
  -> deterministic risk and health calculations -> PostgreSQL snapshots
  -> authenticated API and existing UI
  -> optional investigative ML signals / advisory AI explanations
```

PostgreSQL is the sole runtime persistence and queue system. The API creates durable run/job records in one transaction; no second enqueue operation can fail after that transaction commits. Workers atomically claim work using `SKIP LOCKED`, renew a bounded lease, and fence status updates with the lease token. Expired work is retried up to its persisted attempt limit with bounded backoff; exhausted jobs are marked dead-letter and their run is failed explicitly.

All code graph records are scoped by organization, repository, commit, and analysis run. PostgreSQL RLS remains enabled and forced. A narrow worker queue policy allows workers to discover jobs across tenants; processing and all other tenant data access run under the claimed job's organization context. Graph writes use deterministic IDs and run-scoped uniqueness for safe replays. Migration `0014_postgres_queue_and_code_graph.sql` retains prior rows with a null run association and adds the new run-scoped relationships without resetting data.

Deterministic analysis remains authoritative. ML may add investigative signals; AI may produce advisory explanations only. Neither can create or confirm authoritative findings, evidence, risk, or health. Unsupported parsing and incomplete evidence remain visible as partial coverage.

## Component status

The PostgreSQL-backed queue and code-graph implementation is being introduced by migration 0014 and its focused unit tests. It is not live-validated against the configured application database in this worktree. Do not claim production migration or end-to-end acceptance until migration 0014, database-backed queue concurrency/retry behavior, and authenticated API readback are verified against a disposable or explicitly approved database.

See [API.md](API.md), [ANALYZERS.md](ANALYZERS.md), [CODE_IR.md](CODE_IR.md), [DATABASE_DESIGN.md](DATABASE_DESIGN.md), [FINDINGS.md](FINDINGS.md), [HEALTH.md](HEALTH.md), and [OBSERVABILITY.md](OBSERVABILITY.md) for detailed contracts.
