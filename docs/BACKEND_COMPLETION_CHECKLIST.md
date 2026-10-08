# BugZero Backend Completion Checklist

Audit updated: 2026-10-08

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
- [x] **Migration runner and canonical schema definitions.** Migrations 0001–0009 define the tenant-scoped schema, indexes, keys, constraints, idempotency, local source snapshots, account credentials, and RLS policies.
  - Validation: migration loading, ordering, checksum, and SQL envelope tests; migrations 0001–0009 are applied to local PostgreSQL 17.11. Live registration and local snapshot persistence verify the new schema with RLS enabled.
  - Tests: `packages/database/tests/migrations.test.ts` and `apps/workers/tests/migrations.test.ts`.

### Local code validation

- [x] **`pnpm test`.** PASS: 125 tests (123 pass, 2 skipped — live-service integration tests run separately).
- [x] **`pnpm typecheck`.** PASS: root plus API, worker, database, contracts, and config workspaces.
- [x] **`pnpm lint`.** PASS: root plus API, worker, database, and config workspaces. Non-web packages print benign Next ESLint Pages-directory notices.
- [x] **`pnpm build`.** PASS: Next.js and API, worker, database, contracts, and config workspaces.
- [x] **`git diff --check`.** PASS.

## CURRENT MVP COMPLETION PRIORITIES

Complete in this order. Do not rebuild the completed core pipeline listed above.

### 1. PostgreSQL runtime and migration application — VERIFIED

- [x] **Make PostgreSQL available locally.** Native PostgreSQL 17.11 is running as Windows service `postgresql-x64-17`; `localhost:5432` accepts connections. The `bugzero` database and `bugzero` role are configured. PostgreSQL listens on `localhost` only.
- [x] **Apply migrations 0001–0009.** The migration runner completed against local PostgreSQL 17.11; migration 0009 was applied after 0001–0008 were already present.
- [x] **Verify scoped persistence and rollback.** Against live PostgreSQL, transaction-scoped writes and readbacks succeeded for organization, user, membership, repository, and commit records; transaction rollback left no test organization behind.
- [x] **Verify broader database behavior.** Duplicate analysis/occurrence/evidence/risk/health persistence confirmed idempotent via ON CONFLICT handling. Tenant-isolation scenarios confirmed via live RLS test. All seven migrations confirmed idempotent on rerun.

### 2. Tenant/RLS context — VERIFIED

- [x] **Tenant context is established in every tenant-scoped transaction.** The `onRoute` hook in `createApiServer` calls `withOrganizationContext(principal.organizationId, ...)` for every authenticated request, setting the async-local-storage context. Pool queries issued within that context wrap each statement in a client transaction with `SET LOCAL app.organization_id = $1`, which activates the RLS policies defined in migration 0001. Worker queue consumption does the same via `withOrganizationContext` in `createAnalysisQueueWorker`. Repository adapters that perform multi-statement atomic operations use `setTransactionOrganizationContext` to set the value on an explicit client.
- [x] **Isolation verified against live PostgreSQL.** The live integration test (`BUGZERO_LIVE_INTEGRATION=1`) confirmed: organization A cannot read organization B repositories (cross-tenant `getById` returns null), and a write attempt scoped to A's context with B's organization ID is rejected by the RLS policy with a constraint error. Unauthenticated requests never receive org context; authenticated requests for org A cannot touch org B data.

### 3. Trusted authentication and account onboarding — IMPLEMENTED; live persistence verified

- [x] **Create persisted accounts and workspaces.** Registration stores the user, scrypt password hash, organization/workspace, and OWNER membership transactionally. Login checks the stored password and membership before issuing a token.
- [x] **Use the existing signed-token architecture.** First-party account registration/login issues EdDSA JWTs verified by `AUTH_PUBLIC_KEY`. Local signing keys remain outside the repository; production uses the matching `AUTH_PRIVATE_KEY` from a secret manager.
- [x] **JWT verification covers all required claims.** `createSignedTokenAuthenticator` validates: EdDSA algorithm, JWT type header, issuer, audience, expiration, issued-at skew, UUID format for `sub` and `org`. Invalid signature, wrong issuer, wrong audience, expired token, and non-UUID identity claims are all rejected with null (resulting in 401). Verified by `apps/api/tests/integration/auth.test.ts`.
- [x] **No configured/demo user login path.** Account credentials, user identity, workspace, and membership come from PostgreSQL; there are no hardcoded user or organization IDs in the active sign-in flow.
- [x] **Apply migration 0009 and verify registration/login against PostgreSQL with RLS enabled.** The transaction sets the new tenant ID before creating the organization and membership; `live-onboarding.test.ts` verifies persisted registration, login, and authenticated tenant access.

### 4. Local ZIP repository onboarding — IMPLEMENTED; live pipeline verified

- [x] **Expose ZIP as the sole repository-ingestion method.** Authenticated `POST /repositories/local-zip` checks organization membership/role and persists a `LOCAL` repository, snapshot revision, file metadata, source text, and SHA-256 hashes atomically. `POST /repositories` is no longer a repository-creation route.
- [x] **Reject unsafe or invalid ZIP content before persistence.** Compressed size is capped at 10 MiB, entries at 2,000, total expansion at 20 MiB, and individual files at 1 MiB. Traversal/absolute/conflicting paths, symlinks, encrypted entries, malformed/corrupted data, binary source, and invalid UTF-8 source are rejected.
- [x] **Generate reproducible snapshot identity and use the existing worker source.** ZIP source is committed with fixed Git identity/timestamps; the worker reads persisted local snapshot content and validates hashes before parsing. Source is passed through the existing parser, Code IR, intelligence, analyzers, findings/evidence/risk/health pipeline.
- [x] **Run local ZIP ingestion through live PostgreSQL/Redis/worker.** `live-onboarding.test.ts` uploads vulnerable source, persists the local snapshot, enqueues the real analysis job, and verifies a real finding with evidence/risk plus completion, repository detail, health, and history.

### 5. Redis runtime and queue/worker execution — VERIFIED

- [x] **Make Redis-compatible runtime available locally.** Memurai Developer 4.1.2 is running as Windows service `Memurai`, listens on `localhost:6379`, and responds to `PING`; its reported Redis-compatible API version is 7.2.5.
- [x] **Verify live queue processing and retry exhaustion.** Against live Redis, a uniquely identified job was enqueued and consumed by the existing BullMQ worker. An always-failing job ran three attempts and remained in BullMQ's failed set.
- [x] **Verify broader queue behavior.** The live integration test verified: `POST /analysis` enqueues into the `bugzero-analysis-jobs` queue; the worker consumes the job, runs the analysis pipeline, and commits results to PostgreSQL; idempotency replay (re-enqueue of the same `jobId` after removal) produces no duplicate findings, occurrences, evidence, risk, or health records; a forced source-provider failure causes all three BullMQ attempts to fail and the run reaches `FAILED`/`DEAD_LETTER` terminal state. Queue name and payload schema (`{organizationId, jobId}`) are consistent between API and worker via `@bugzero/contracts`.

### 6. Real API → Redis → worker → PostgreSQL analysis and persistence — VERIFIED

- [x] **Run an authenticated end-to-end analysis.** The existing live integration test (`apps/api/tests/integration/live-backend.test.ts`, run with `BUGZERO_LIVE_INTEGRATION=1`) exercises a persisted fixture repository → `POST /analysis` → BullMQ job in Redis → worker consumption → TypeScript parsing → Code IR persistence → Repository Intelligence → Structural/Quality and SQL Injection analyzers → findings, occurrences, evidence snapshots, risk assessments, and health snapshot persisted in PostgreSQL. Status is polled via `GET /analysis/:runId` until terminal.
- [x] **Verify persistence and API readback.** Findings, occurrences, evidence, risk assessments, and health snapshots confirmed present via `withOrganizationContext` database reads and via `GET /repositories/:id/findings` and `GET /findings/:id` API responses.
- [x] **Repeat the analysis and verify replay/idempotency.** The completed BullMQ job was removed and re-enqueued with the same `jobId`. After worker completion, finding count, occurrence count, evidence count, and risk count were all identical to the first run — no duplicates created.
- [x] **Verify failure path.** A forced source-provider failure causes all three BullMQ attempts to fail; the run reaches `FAILED` status with `DEAD_LETTER` job state.

### 7. Frontend → real backend integration — IMPLEMENTED

- [x] **Connect authenticated screens to persisted APIs.** Login/register use signed sessions; repository list/detail and product data are loaded from authenticated tenant-scoped endpoints. API failures do not fall back to sample data.
- [x] **Connect ZIP onboarding to analysis dispatch.** The UI uploads a `.zip`, then submits the returned real repository ID and commit SHA to the existing `POST /analysis`; repository detail polls persisted run/job status.
- [x] **Do not expose backend configuration.** The browser uses the same-origin API proxy; no API URL/key/configuration UI is exposed.

### 8. Full end-to-end product validation

- [x] **Verify onboarding and analysis against live services.** Registration → persisted workspace → login → empty repository state → ZIP upload → snapshot → existing queue/worker → completed run → real finding/evidence/risk → health/history. Browser refresh and logout are covered at the frontend auth/session layer, not by the live-service test.
- [ ] **Complete operational failure-path checks.** Verify invalid/missing repositories, invalid input, parser/analyzer failures, worker failure, database outage, Redis unavailability, duplicate analysis, and cancellation if cancellation is implemented.

## FUTURE / OPTIONAL

- [ ] **Containerized deployment (Docker/Compose).** Intentionally deferred and not required for current MVP/demo backend completion. Local PostgreSQL/Redis and application processes are sufficient for current backend verification. Docker must not be treated as a blocker.
- [ ] **Downloadable report generation/object storage.** The current product API supports report listing; generation/download/object storage is future work unless downloadable artifacts become an MVP requirement.
- [ ] **Resolve the analysis-engine ownership ADR.** ADR-001 assigns parsing/analysis/evidence to Python while the tested worker pipeline is TypeScript and the `engine/` Python tree is not integrated. Record an architecture decision before extending or porting the execution path; this does not invalidate the existing tested pipeline.

## SERVICE AVAILABILITY AT THIS UPDATE

- **PostgreSQL:** PostgreSQL 17.11 has migrations 0001–0009 applied. Live registration/login and local snapshot persistence were verified against PostgreSQL with RLS enabled.
- **Redis:** Memurai Developer 4.1.2 is running as `Memurai` on localhost port 6379; `PING` returned `PONG`. BullMQ enqueue, worker consumption, retry exhaustion, replay idempotency, and terminal failure retention all verified.
- **Local environment:** `.env.local` is Git-ignored and contains local connection configuration. No credentials or secrets were added to tracked files.
- **Application:** `apps/api/tests/integration/live-backend.test.ts` covers the existing authenticated pipeline; `apps/api/tests/integration/live-onboarding.test.ts` covers real registration/login and LOCAL ZIP → Redis/BullMQ → worker → PostgreSQL analysis, including a persisted finding, evidence graph, and risk assessment. Successful analysis creates immutable records, so its live-test tenant is retained; use a disposable database for repeated runs.
- **Docker:** not used. Containerized deployment remains FUTURE / OPTIONAL.

## VALIDATION AT THIS UPDATE

- `pnpm test`: **PASS**, 125 tests (123 pass, 2 skipped).
- `pnpm typecheck`: **PASS**, including API, worker, database, contracts, and config.
- `pnpm lint`: **PASS**, including root, API, worker, database, and config.
- `pnpm build`: **PASS**, including Next.js and backend workspaces.
- `git diff --check`: **PASS**.
- `pnpm --filter @bugzero/workers typecheck`: **PASS**.
- `pnpm --filter @bugzero/workers test`: **PASS**, 100 tests, 0 failures.
- `pnpm --filter @bugzero/workers lint`: **PASS**.
- `pnpm --filter @bugzero/api typecheck`: **PASS**.
- `pnpm --filter @bugzero/api test`: **PASS**, 8 tests (auth: 8), 0 failures. Product/analysis/onboarding: 7 additional tests in `apps/api/tests/integration/`, all PASS.
- `pnpm --filter @bugzero/database typecheck`: **PASS**.
- Live PostgreSQL: **PASS** — connection, migrations 0001–0007, idempotent rerun, checksums, scoped persistence, RLS isolation.
- Live Redis: **PASS** — `PING`, enqueue, consumption, retry exhaustion, idempotent replay.
- Full authenticated API → Redis → worker → PostgreSQL analysis, tenant-context/RLS isolation, persistence/readback/replay: **PASS** (verified `2026-10-08`).
- Live registration/login → empty repository list → ZIP snapshot → analysis worker → finding/evidence/risk, repository detail, health, and history: **PASS**.

## OVERALL STATUS

**First-party account/workspace onboarding and ZIP-only local repository ingestion are implemented using the existing EdDSA auth and analysis pipeline. Unit/type tests pass, migrations 0001–0009 are applied locally, and registration plus ZIP-to-analysis passed against live PostgreSQL, Redis, and a worker. Browser refresh/logout are covered by frontend auth/session tests rather than the live-service test. Production signing keys must be supplied via a secret manager. Docker is not a blocker.**
