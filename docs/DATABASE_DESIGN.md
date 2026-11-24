# BugZero database design

## Persistence boundary

Neon PostgreSQL, accessed through the standard `pg` driver and `DATABASE_URL`, is the sole runtime database and durable job queue. The application rejects missing, malformed, or non-Neon database URLs instead of falling back to a local server. Use `DATABASE_URL_UNPOOLED` for the migration runner. The local Neon project link does not apply migrations; run the SQL migration runner only against an explicitly verified target.

| Data | PostgreSQL source of truth |
|---|---|
| Users, organizations, memberships, repositories, commits, source snapshots | Existing tenant-scoped tables |
| Analysis runs, jobs, profiles, coverage and history | `analysis_runs`, `analysis_jobs`, `analysis_profiles` |
| Code representation and relationships | `code_entities`, `code_relationships` |
| Direct dependencies and dependency links | `dependencies`, `dependency_edges` |
| Source-to-sink links | `data_flow_edges` |
| Findings, occurrences, evidence, risk, health and reports | Existing immutable and revisioned analysis tables |
| Queue readiness, retries, attempts and leases | `analysis_jobs` |

The frontend and authentication/tenant model are unchanged. Tenant-owned records carry `organization_id`; forced row-level security and tenant-composite foreign keys remain in effect.

## Durable analysis queue

The API inserts the analysis run and queued job transactionally. That committed job row is the enqueue operation; there is no external broker whose outage can leave the API returning a success-shaped response without durable work.

Workers select eligible jobs in a transaction using `FOR UPDATE SKIP LOCKED`, increment attempts, and set a lease owner and expiry. They renew leases while processing. Updates to job status/stage are fenced by the active lease owner. Failed jobs are retried with bounded exponential backoff up to the persisted `max_attempts`; expired leases are reclaimed or dead-lettered. A worker failure to persist retry/dead-letter state is surfaced rather than silently acknowledged.

Queue discovery spans tenants through a worker-only `analysis_jobs` RLS policy. Job processing and all other tenant-owned reads/writes execute under the claimed organization context. The queue worker policy is not used for other tenant tables.

## Run-scoped code intelligence

`code_entities` stores parsed files, symbols, functions, and dependency entities. `code_relationships` stores code relationships such as imports, declarations, calls, and dependency links. Direct source-to-sink paths with validated complete evidence are stored in `data_flow_edges`. `dependencies` stores normalized package declarations; `dependency_edges` remains available for package-to-package links. Repository intelligence queries filter by organization, repository, commit, and analysis run.

The forward-only migration `0014_postgres_queue_and_code_graph.sql` adds queue lease/retry columns and indexes, adds nullable `analysis_run_id` columns to historical code/dependency records, establishes run-scoped uniqueness and foreign keys, and creates the RLS-protected data-flow table. Existing records are retained with a null run association. New worker writes always include a run ID. Deterministic IDs and upserts make snapshot replay idempotent. Graph/database failures fail analysis; there is no fallback that masks a persistence outage.

## Findings and evidence

Findings represent semantic issues; immutable occurrences record a specific observation at a commit and run. Evidence snapshots retain authority, completeness, sufficiency, analyzer versions, paths, diagnostics, and an idempotency fingerprint. Evidence nodes and edges belong to one snapshot. Incomplete evidence cannot claim sufficiency, and a resolved finding requires authoritative, complete evidence for a completed `NOT_DETECTED` occurrence.

Deterministic analysis is authoritative. ML is investigative and AI is advisory; neither can promote findings/evidence or change risk/health. Unsupported parsers and unlinked or incomplete evidence remain visible as partial coverage.

## Risk and health

Risk assessments are deterministic and versioned. Health snapshots are deterministically derived from persisted analysis state. The formula specifications live in [RISK.md](./RISK.md) and [HEALTH.md](./HEALTH.md); API results are read from persisted PostgreSQL records.

## Migrations and data preservation

Migration files are append-only and checksummed. Never rewrite applied migrations or reset production databases. Validate migrations on a disposable Neon branch before production review. Existing historical migration files and database records are preserved.
