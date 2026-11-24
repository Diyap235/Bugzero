# BugZero backend completion checklist

Updated 2026-10-10

## Preserved application capabilities

- Authentication, user/workspace onboarding, membership checks, and organization-scoped authorization remain part of the application.
- Repository onboarding, existing frontend flows, findings, immutable evidence, deterministic risk/health formulas, and historical PostgreSQL data/migrations are retained.
- Deterministic analysis is authoritative; ML remains investigative, and AI remains advisory.

## PostgreSQL-only engine replacement

- [x] Replace external queue publication with transactionally persisted `analysis_jobs`.
- [x] Add indexed queue readiness/lease/retry state and a worker-only RLS queue policy.
- [x] Implement `FOR UPDATE SKIP LOCKED` claims, lease renewal, retry backoff, attempt limits, expired-lease recovery, and lease-fenced worker status updates.
- [x] Replace graph adapter writes/reads with tenant- and run-scoped PostgreSQL records, including a dedicated data-flow edge table.
- [x] Add forward-only migration `0014_postgres_queue_and_code_graph.sql`; historical graph/dependency records remain run-unassociated rather than being deleted.
- [x] Remove active Redis/BullMQ/Neo4j imports and environment configuration from application code and examples.
- [ ] Validate migration 0014 and queue/graph persistence against a disposable PostgreSQL database.
- [ ] Run live authenticated SQL-injection analysis, safe parameterized query control, persistence/readback, retry/recovery, RLS isolation, and UI/API agreement.
- [ ] Complete full test suite, typechecks, builds, lint, and `git diff --check`.

## Acceptance evidence

Unit and static validation results must be reported from the current worktree after the replacement is complete. Live database tests require `BUGZERO_LIVE_INTEGRATION=1` and an explicitly disposable `DATABASE_URL` with the current migrations applied. Do not run this suite against Neon production or any database with user data.

No result from the earlier Redis or graph-database architecture is acceptance evidence for this replacement.
