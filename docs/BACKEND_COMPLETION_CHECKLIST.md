# BugZero Backend Completion Checklist

Audit updated: 2026-10-07

This checklist distinguishes tested application behavior from live-service verification. A fixture-driven or in-memory test is not evidence of a PostgreSQL/Redis end-to-end run.

## COMPLETED

### Existing core pipeline

- [x] **Parsing and Code IR.** The worker reads fixture source, parses supported languages, and builds/persists Code IR.
  - Validation: deterministic worker pipeline tests.
  - Tests: `apps/workers/tests/analysis-job.test.ts` and parser/Code IR suites.
- [x] **Repository Intelligence and analyzer orchestration.** Repository intelligence and impact scope feed the analyzer orchestrator and the existing Structural/Quality and SQL Injection analyzers.
  - Validation: fixture pipeline and focused analyzer tests.
  - Tests: worker intelligence, impact, analyzer, and analysis-job suites.
- [x] **Findings, occurrences, evidence, risk, and health.** The worker persists the outputs and health snapshot; persistence adapters support deterministic replay.
  - Validation: fixture pipeline, evidence bounds/diagnostics, risk, health, and replay tests.
  - Tests: worker finding/evidence/risk/health suites and `apps/workers/tests/analysis-job.test.ts`.
- [x] **Analysis jobs and retry/final-failure state.** Analysis requests create/reuse jobs; retry attempts persist `RETRY`, attempt counts, and final `DEAD_LETTER`/failed-run state.
  - Validation: API injection and worker attempt-state tests. Redis execution itself is not implied.
  - Tests: `apps/api/tests/integration/analysis.test.ts` and `apps/workers/tests/retry-state.test.ts`.
- [x] **Report listing and structured API errors.** Report summaries have a typed route/response contract, and unhandled errors produce safe structured responses.
  - Validation: API injection checks response shape and confirms internal error details are not returned.
  - Tests: `apps/api/tests/integration/product.test.ts`.
- [x] **Migration runner and canonical schema definitions.** Migrations 0001–0007 define the tenant-scoped schema, indexes, keys, constraints, idempotency, and RLS policies. The runner orders migrations, advisory-locks application, records checksums, rejects changed applied migrations, and applies each migration with its history entry transactionally.
  - Validation: migration loading, ordering, checksum, and SQL envelope tests; applied to local PostgreSQL 17.11 and rerun without changes. The database contains all seven migration filenames with seven distinct checksums.
  - Tests: `packages/database/tests/migrations.test.ts` and `apps/workers/tests/migrations.test.ts`.

### Local code validation

- [x] **`pnpm test`.** PASS: 100 tests.
- [x] **`pnpm typecheck`.** PASS: root plus API, worker, database, contracts, and config workspaces.
- [x] **`pnpm lint`.** PASS: root plus API, worker, database, and config workspaces. Non-web packages print benign Next ESLint Pages-directory notices.
- [x] **`pnpm build`.** PASS: Next.js and API, worker, database, contracts, and config workspaces.
- [x] **`git diff --check`.** PASS.

## CURRENT MVP COMPLETION PRIORITIES

Complete in this order. Do not rebuild the completed core pipeline listed above.

### 1. PostgreSQL runtime and migration application — VERIFIED LOCALLY (LIMITED)

- [x] **Make PostgreSQL available locally.** Native PostgreSQL 17.11 is running as Windows service `postgresql-x64-17`; `localhost:5432` accepts connections. The `bugzero` database and `bugzero` role are configured. PostgreSQL listens on `localhost` only.
- [x] **Apply migrations 0001–0007.** The migration runner completed, was rerun, and reported seven migration-history rows with seven distinct checksums. The second run made no migration changes.
- [x] **Verify scoped persistence and rollback.** Against live PostgreSQL, transaction-scoped writes and readbacks succeeded for organization, user, membership, repository, and commit records; transaction rollback left no test organization behind.
- [ ] **Verify broader database behavior.** Duplicate analysis/occurrence/evidence/risk/health persistence, tenant-isolation scenarios, and database-unavailable behavior were not covered by the live persistence check.

### 2. Tenant/RLS context — IMPLEMENTATION GAP

- [ ] **Establish tenant context in every tenant-scoped transaction.** Migration policies require transaction-local `app.organization_id`; repository adapters currently issue pool queries without setting that value. Add a tenant-bound transaction path and wire every tenant-owned API and worker repository operation to it. Keep explicitly global identity/bootstrap operations separate; do not bypass or weaken RLS.
- [ ] **Verify isolation against PostgreSQL.** Test tenant A can access A, tenant A cannot read or write B, tenant B can access B, and absent tenant context fails safely. Test reads and writes with forced RLS enabled.

### 3. Trusted authentication — IMPLEMENTATION GAP

- [x] **Provide a development-only server-verifiable token path.** The API verifies EdDSA JWTs with the configured Ed25519 `AUTH_PUBLIC_KEY`; a local-only issuer stores its private key outside the repository and is not a production identity provider.
- [ ] **Provide a production authentication provider.** No production issuer, signer, or identity provider is implemented. Deployments must configure a trusted adapter or a public key and issuer/audience from their chosen provider. The frontend demo token remains client-only and must not be accepted as backend authentication.
- [ ] **Resolve identity and authorization before tenant access.** Establish the authenticated user, organization membership, tenant, and authorized repository from trusted identity and membership data; then establish tenant context for database operations. Never trust a caller-supplied organization ID as proof of membership.

### 4. Repository/GitHub onboarding — IMPLEMENTATION GAP

- [ ] **Expose an authorized repository registration and ingestion flow.** Existing ingestion/provider and persistence code are not exposed as an authorized onboarding workflow. Verify organization ownership, provider/source metadata, default branch and ref, credentials/secret handling, repository authorization, and commit indexing.
- [ ] **Bound source acquisition before collecting source into memory.** The current Git provider clones/checks out and collects supported files before the processor applies its file-count limit. Enforce file-count, total-byte, disk, process, and wall-clock limits at acquisition; treat repository contents and Git metadata as untrusted input.

### 5. Redis runtime and queue/worker execution — VERIFIED LOCALLY (LIMITED)

- [x] **Make Redis-compatible runtime available locally.** Memurai Developer 4.1.2 is running as Windows service `Memurai`, listens on `localhost:6379`, and responds to `PING`; its reported Redis-compatible API version is 7.2.5.
- [x] **Verify live queue processing and retry exhaustion.** Against live Redis, a uniquely identified job was enqueued and consumed by the existing BullMQ worker. An always-failing job ran three attempts and remained in BullMQ's failed set. This verifies queue-level terminal failure retention, not a PostgreSQL dead-letter transition.
- [ ] **Verify broader queue behavior.** API-to-queue status transitions, duplicate delivery/idempotency, worker restart/redelivery, Redis loss, and safe shutdown were not covered by this runtime check.

### 6. Real API → Redis → worker → PostgreSQL analysis and persistence

- [ ] **Run an authenticated end-to-end analysis.** Exercise the actual flow: authenticated API request → authorized repository/commit → analysis job → Redis → worker → bounded source acquisition → parser → Code IR → Repository Intelligence → analyzers → findings/occurrences/evidence/risk/health → PostgreSQL.
- [ ] **Verify persistence and API readback.** Confirm persisted rows and tenant ownership for every pipeline output; read them back through the authenticated API after worker completion.
- [ ] **Repeat the analysis and verify replay/idempotency.** Verify duplicate requests and worker redelivery do not create duplicate runs/jobs or duplicate occurrences/evidence/risk/health records.

### 7. Frontend → real backend integration

- [ ] **Connect the existing product screens after the real backend is verified.** Preserve the existing UI. Use internal application configuration and trusted authentication; do not expose API URL/key, backend configuration, connection/status UI, or the demo token as backend credentials.

### 8. Full end-to-end product validation

- [ ] **Verify the complete product flow against the real services.** Landing → login → dashboard → repository onboarding → analysis → status → findings/evidence/risk/health → history/report → logout. This remains unchecked until it has actually run through the real API, PostgreSQL, Redis, and worker.
- [ ] **Complete operational failure-path checks.** Verify invalid/missing repositories, invalid input, parser/analyzer failures, worker failure, database outage, Redis unavailability, duplicate analysis, and cancellation if cancellation is implemented.

## FUTURE / OPTIONAL

- [ ] **Containerized deployment (Docker/Compose).** Intentionally deferred and not required for current MVP/demo backend completion. Local PostgreSQL/Redis and application processes are sufficient for current backend verification. Docker must not be treated as a blocker.
- [ ] **Downloadable report generation/object storage.** The current product API supports report listing; generation/download/object storage is future work unless downloadable artifacts become an MVP requirement.
- [ ] **Resolve the analysis-engine ownership ADR.** ADR-001 assigns parsing/analysis/evidence to Python while the tested worker pipeline is TypeScript and the `engine/` Python tree is not integrated. Record an architecture decision before extending or porting the execution path; this does not invalidate the existing tested pipeline.

## SERVICE AVAILABILITY AT THIS UPDATE

- **PostgreSQL:** PostgreSQL 17.11 is running as `postgresql-x64-17`, bound to localhost port 5432 only. The `bugzero` database and role are configured; the application connection was used for migrations and live persistence checks.
- **Redis:** Memurai Developer 4.1.2 is running as `Memurai` on localhost port 6379; `PING` returned `PONG`, and live BullMQ enqueue/consumption/retry processing succeeded.
- **Local environment:** `.env.local` is Git-ignored and contains local connection configuration. No credentials or secrets were added to tracked files.
- **Application:** a complete live API → Redis → worker → PostgreSQL analysis was not run.
- **Docker:** not used. Containerized deployment remains FUTURE / OPTIONAL.

## VALIDATION AT THIS UPDATE

- `pnpm test`: **PASS**, 100 tests.
- `pnpm typecheck`: **PASS**, including API, worker, database, contracts, and config.
- `pnpm lint`: **PASS**, including root, API, worker, database, and config.
- `pnpm build`: **PASS**, including Next.js and backend workspaces.
- `git diff --check`: **PASS**.
- `pnpm --filter @bugzero/workers typecheck`: **PASS**.
- `pnpm --filter @bugzero/workers test`: **PASS**, 89 tests, 0 failures. These automated tests are distinct from the additional live Redis runtime check.
- `pnpm --filter @bugzero/workers lint`: **PASS**.
- `pnpm --filter @bugzero/api typecheck`: **PASS**.
- `pnpm --filter @bugzero/api test`: **PASS**, 5 tests, 0 failures.
- `pnpm --filter @bugzero/database typecheck`: **PASS**.
- Live PostgreSQL: **PASS** for localhost-only listener, connection, migrations 0001–0007/idempotent rerun/checksums, and scoped repository persistence/readback/rollback.
- Live Redis: **PASS** for `PING`, enqueue, worker consumption, three attempts, and terminal BullMQ failed-set retention.
- Full authenticated API → Redis → worker → PostgreSQL analysis, backend tenant-context wiring/RLS isolation, and end-to-end persistence/readback/replay: **NOT VERIFIED**.

## OVERALL STATUS

**Native PostgreSQL and Redis-compatible services, migrations, scoped persistence, queue consumption, and retry exhaustion have been verified locally. Full live API → Redis → worker → PostgreSQL analysis remains unverified. Tenant-context/RLS wiring, trusted authentication, repository onboarding, and broader replay/failure-path validation remain implementation or verification gaps. Do not claim production readiness or real end-to-end completion. Docker is not a blocker.**
