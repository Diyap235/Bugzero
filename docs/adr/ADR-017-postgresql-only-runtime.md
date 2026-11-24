# ADR-017 — PostgreSQL-Only Runtime and Durable Analysis Queue

- **Status:** Accepted
- **Date:** 2026-10-10
- **Decision:** Use Neon PostgreSQL for product data, code intelligence persistence, and durable analysis jobs.

## Context

BugZero requires tenant-scoped relational data and repository code relationships, with retry-safe asynchronous analysis. Maintaining a separate graph database and broker adds independent service configuration and failure modes. The existing PostgreSQL schema already contains tenant-protected entity, relationship, dependency, and job tables that can be extended forward-only.

## Decision

- PostgreSQL is the sole runtime persistence and queue system.
- API admission transactionally creates the run and job. A committed job row is the durable queue entry.
- Workers claim jobs atomically using `FOR UPDATE SKIP LOCKED`, persisted attempt limits, bounded leases, and exponential retry delays.
- Worker status updates are fenced by lease owner. Job discovery uses a narrow worker RLS policy; processing uses the job's organization context.
- Code entities, relationships, dependencies, and data-flow edges are stored in PostgreSQL and scoped to organization, repository, commit, and analysis run.
- Existing PostgreSQL records and migration history are preserved. Migration 0014 adds queue state and run-scoped graph identity and creates data-flow storage without deleting historical rows.
- Deterministic analysis remains authoritative; ML is investigative and AI is explanatory only.

## Consequences

- Tenant-scoped API/worker processing uses `DATABASE_URL`; queue claims use a separate `DATABASE_QUEUE_URL` credential for the dedicated non-`BYPASSRLS` `bugzero_queue_worker` login. No Redis or Neo4j connection settings remain.
- Queue and code-intelligence persistence share PostgreSQL availability and operational controls.
- Database-backed concurrency, retries, tenant isolation, graph replay, and authenticated API readback must be tested against a disposable database before production deployment.

## Superseded decisions

This decision supersedes the queue transport in [ADR-006](ADR-006-analysis-jobs.md) and the graph-storage boundary in [ADR-016](ADR-016-postgresql-neo4j-engine.md). Their files remain as historical decision records.
