# MISSION 10 — BUGZERO STEP-BY-STEP COMPLETE RECOVERY

You are the senior engineer responsible for getting BugZero's original analysis pipeline working end to end.

Your working method is STRICTLY CHECKLIST-DRIVEN.

**Complete ONE checklist item at a time. Do not jump ahead. Do not work on multiple unrelated issues simultaneously. Do not repeatedly retry the same failing step.**

Your goal is to recover the original analysis and verify that real findings and evidence are persisted and visible in the application.

---

# A. STRICT EXECUTION RULES

1. Inspect the current implementation before making changes.
2. Work on exactly ONE checklist item at a time.
3. Identify the issue and its root cause.
4. Fix that issue completely.
5. Add or update regression tests.
6. Run the relevant tests and typechecks.
7. Verify the fix.
8. Mark the checklist item DONE only when verification succeeds.
9. Move to the next unchecked item.
10. Never leave a partially completed item and silently move forward.

### Time and retry limits

- Spend a maximum of 20 minutes on one checklist item.
- Allow at most 2 implementation attempts for the same root cause.
- Allow at most 2 test-fix cycles after implementation.
- If blocked by credentials, external permissions, unavailable services, or an approval requirement, mark the item BLOCKED.
- Record the exact reason and evidence.
- Move to the next independent checklist item when safe.
- Never repeatedly execute the same failed command without changing the underlying cause.
- Never run an endless retry loop.
- Never claim an item is complete without verification.

If a task genuinely needs more than 20 minutes, divide it into smaller checklist items before continuing.

---

# B. ORIGINAL TARGET

The only target analysis for this recovery is:

- Analysis ID: `070e87e4-2242-46e2-99a9-7620d5fc8d4a`
- Job ID: `94e79bc7-a7f6-43d3-b2bd-40e9b328c5bc`

Do not confuse it with unrelated test jobs.

# C. MASTER CHECKLIST

Update this checklist as you work. Keep the status accurate.

## Phase 1 — Repository and target verification

- [x] DONE — 1. Git inspection complete: branch `frontend/mann`; 239 existing worktree status entries (44 modified, 175 deleted, 20 untracked); 0 staged paths; 219 tracked diff paths. No edits made during inspection.
- [x] DONE — 2. Preservation verified: the initial dirty worktree was left intact; task edits are limited to `a.md`, the worker queue test, and the worker SQL analyzer/test. No unrelated changes were reverted, staged, or committed.
- [x] DONE — 3. Target job exists in the configured database (`EXISTS = true`, read-only SELECT).
- [x] DONE — 4. Verified by joining `analysis_jobs.run_id` to `analysis_runs.id`; the job belongs to the specified analysis.
- [x] DONE — 5. The target analysis row is the authoritative source; its `organization_id` is `54ce64c7-a0b1-4d71-aa3c-388863c50256` (read-only SELECT).
- [x] DONE — 6. Read-only join confirms the run and job share organization `54ce64c7-a0b1-4d71-aa3c-388863c50256`, matching the analysis row.
- [x] DONE — 7. Before execution, the target was `QUEUED`, available, unstarted, with no lease/error and retry counter 0 of 3. No separate `analysis_job_attempts` table exists, so detailed attempt history is not persisted.

**Phase completion:** The exact target and its organization were verified before the controlled run.

## Phase 2 — Worker safety and tenant isolation

- [x] DONE — 8. Inspected `worker/src/worker.ts` and `worker/src/jobs/analysis-queue.ts`; CLI and queue support scoped single-job mode.
- [x] DONE — 9. Scoped CLI requires the paired `--job-id` and `--organization-id`; the queue constructor rejects one without the other.
- [x] DONE — 10. Missing/malformed scoped arguments are rejected by parser validation; `worker-config.test.ts` passed (3/3).
- [x] DONE — 11. Scoped candidate claim binds both target UUIDs; existing queue tests assert both SQL filters and reject mismatched job/organization records.
- [x] DONE — 12. Expired-lease dead-letter sweep binds the same target job and organization UUIDs; existing test asserts both filters and rejects out-of-scope finalization.
- [x] DONE — 13. Scoped processing re-reads the job and run under organization context and checks job ID, organization, run ID, RUNNING status, and attempt before invoking the processor; a mismatched-run regression test exists.
- [x] DONE — 14. Single-job mode establishes tenant context from the claimed database row only after persisted job/run identity checks; lease context uses the same verified job and organization IDs.
- [x] DONE — 15. Lease renewal/acknowledgment are fenced by organization, job, lease owner, and unexpired deadline; retry/backoff is bounded by `max_attempts`. Existing tests cover renewal failure, stale reclaimed leases, concurrency, retries, and dead-lettering.
- [x] DONE — 16. Global mode remains the no-argument path (`parseWorkerArguments([]) -> undefined`); absent target IDs produce unscoped queue options. Existing non-target queue tests exercise this path.
- [x] DONE — 17. Added focused regression cases for persisted job and run organization mismatches; both passed in the full worker suite.
- [x] DONE — 18. Worker test suite passed (180/180); worker TypeScript typecheck passed.

**Phase completion:** Single-job execution is demonstrably isolated and safe.

## Phase 3 — Database and configuration

- [x] DONE — 19. API/repositories use the shared `DATABASE_URL` pool; queue worker creates a separate pool from `DATABASE_QUEUE_URL`; migration runner alone requires `DATABASE_URL_UNPOOLED`.
- [x] DONE — 20. `createDatabasePool` validates and uses `DATABASE_URL`; API startup requires it, and application repositories default to `getDatabasePool()`.
- [x] DONE — 21. Queue worker uses `getQueueDatabasePool()`, which validates and connects with `DATABASE_QUEUE_URL` and requires username `bugzero_queue_worker`.
- [x] DONE — 22. Read-only connection identity check returned `bugzero_queue_worker` with `BYPASSRLS = false`; no connection string or credential was printed.
- [x] DONE — 23. Read-only privilege checks confirm queue role has public-schema USAGE plus SELECT/UPDATE on `analysis_jobs`, and no INSERT/DELETE.
- [x] DONE — 24. Catalog confirms `analysis_jobs` has RLS enabled/forced and two policies. However, the application connection is `neondb_owner` with `BYPASSRLS = true` (target row visible without tenant context), so RLS does not enforce isolation for application queries; the queue role is non-bypass but an explicit worker policy allows queue access. Application tenant isolation therefore depends on repository/context guards. No DB settings changed.
- [!] BLOCKED — 25. Local `.env.local` targets Neon `neondb` through the same endpoint for API and queue roles (direct endpoint is reserved for migrations); frontend API target is local port 3001. Deployed provider settings are unavailable in this workspace, so production configuration could not be verified.
- [x] DONE — 26. External blockers recorded: deployed env is inaccessible here, and changing the application DB role away from `BYPASSRLS` or changing grants needs separate authorization. No config, role, grant, or RLS changes were made.

**Phase completion:** Existing database configuration is understood and no unauthorized permission changes were made.

Do not change passwords, grants, memberships, RLS policies, database objects, Neon projects, or branches.

## Phase 4 — Pipeline diagnosis and repair

Inspect and verify each boundary separately.

- [x] DONE — 27. Inspected local ZIP validation (archive/entry/count/size/path/type/CRC/UTF-8 checks and supported-source requirement); focused API tests passed (5/5).
- [x] DONE — 28. Repository+commit+file snapshot persistence is transactional and tenant-context guarded. Read-only target join confirms a LOCAL repository, an existing commit, and 5 persisted files with source content.
- [x] DONE — 29. Analysis request path validates membership/repository/commit/profile and transactionally creates or reuses the run/job. Target analysis row exists and links to the persisted repository/commit.
- [x] DONE — 30. `createOrGetActiveWork` inserts the run and its `QUEUED` job in one transaction; the exact target job is persisted with attempt 0 and max attempts 3.
- [-] NOT APPLICABLE — 31. No Redis/BullMQ/ioredis usage exists in the API, worker, or database package; queue coordination is PostgreSQL-backed via `PostgresAnalysisQueueWorker`.
- [x] DONE — 32. PostgreSQL worker claims eligible rows atomically with `FOR UPDATE SKIP LOCKED` and exact target filters in single-job mode. The target remains `QUEUED`; no claim was attempted.
- [x] DONE — 33. Queue claim creates a lease; processing verifies persisted job/run under tenant context and attaches lease owner context. The exact target was claimed and processed once; post-run it has no lease.
- [x] DONE — 34. ZIP is validated on upload; LOCAL worker source provider discovers files from `repository_files`, rejects missing content, and checks byte size/SHA-256. Target has 5 persisted source-content files.
- [x] DONE — 35. Target execution read 5 persisted files, parsed 4 supported source files with 0 parse diagnostics, and then exposed a partial-status bug: the SQL analyzer treated the unsupported JSON dependency manifest as unavailable security source. A focused regression test now covers this case.
- [x] DONE — 36. Target parsing/IR completed with 25 persisted entities and 26 relationships; Repository Intelligence status is COMPLETE.
- [x] DONE — 37. Target is COMMIT scope mapped to FULL. Structural quality completed; SQL injection analysis found one result but incorrectly returned PARTIAL because the unsupported dependency manifest was checked for source availability before filtering to supported languages. The bug is fixed locally; AI review was intentionally disabled for this run.
- [x] DONE — 38. The target orchestrator persisted 1 finding and 1 run-scoped occurrence.
- [x] DONE — 39. Findings use bounded evidence graph construction, persistence, completeness/sufficiency metadata, and risk downgrading on incomplete evidence; target has 0 snapshots/nodes/edges before execution.
- [x] DONE — 40. Stable versioned finding fingerprints and run-scoped `createOccurrenceIfAbsent` persistence are implemented; repository tests cover idempotency/replay. Target has 1 occurrence tied to its exact analysis run.
- [x] DONE — 41. Processor marked the target RUNNING and persisted its terminal result; queue acknowledged the job as COMPLETED after attempt 1. The analysis run itself is PARTIAL, not successful.
- [x] DONE — 42. Retry delays are bounded and lease-fenced; final attempts dead-letter and failed finalization is retried. Worker tests cover transient/final failures and lease loss; 180/180 passed.
- [x] DONE — 43. Inspected analysis status, repository history, findings, detail, and report routes; tenant membership is checked. Target records are persisted, and targeted API route tests pass; live target API requests remain unverified because the local API is not running.
- [x] DONE — 44. Inspected analysis detail, dashboard, findings, and history pages: they render persisted API status/progress/results and explicit empty/error states. Live target UI output remains unverified because neither local frontend nor API is running.

For every failed boundary:

- Find the root cause.
- Fix only that issue.
- Add a regression test.
- Run relevant checks.
- Mark DONE only after successful verification.

Do not proceed past a broken dependency boundary when later items depend on it. Mark dependent items BLOCKED and continue with independent investigations only.

## Phase 5 — Controlled target recovery

This phase requires all relevant safety checks above to pass.

- [x] DONE — 45. Fresh read-only join reconfirms the exact target job, target analysis, and expected organization; all four identity/relationship checks returned true.
- [x] DONE — 46. Fresh read-only check shows `QUEUED`, available now, attempt 0/3, and no lease; eligibility returned true.
- [x] DONE — 47. Read-only queue-role activity check found no other queue sessions, and the target has no live lease.
- [x] DONE — 48. Prepared an in-process scoped launch from `worker`: load `.env.local`, delete `process.env.NVIDIA_API_KEY` before importing worker modules, then call `startWorker({ jobId: "94e79bc7-a7f6-43d3-b2bd-40e9b328c5bc", organizationId: "54ce64c7-a0b1-4d71-aa3c-388863c50256" })`. AI disablement verified (`enabled=false`); this avoids sending repository source to NVIDIA.
- [x] DONE — 49. Executed only the exact job/organization pair through `startWorker`; NVIDIA API key was removed before worker import, so no repository source was sent to an external AI provider. Worker exited normally after one attempt.
- [x] DONE — 50. Post-run SELECT confirms target job `COMPLETED` at attempt 1 with no lease/error; analysis run is `PARTIAL` and completed.
- [x] DONE — 51. Worker logs show 5 files read, 4 parsed, intelligence complete, analyzer statuses COMPLETED/PARTIAL, 1 finding, and no worker failure. Read-only persisted diagnostics identify the exact partial cause: an unsupported `.json` dependency manifest has language `Dependency manifest`; the analyzer's source-exists check ran before its supported-language filter. AI review/investigation were UNAVAILABLE because AI was intentionally disabled.
- [!] BLOCKED — 52. The exact job finished `COMPLETED` at attempt 1, but its analysis run is `PARTIAL`. The source fix is covered by regression tests, but this completed job cannot be rerun without an authorized new/requeued target job; no database state was changed.
- [x] DONE — 53. Read-only SELECT verifies 1 finding, 1 occurrence, and 1 authoritative evidence snapshot for the target run. The snapshot is complete and sufficient, with 1 path, 9 nodes, and 8 edges.

Never start the global worker.

Never process unrelated jobs.

Never fabricate results, force statuses, delete jobs, or manually mark analysis successful.

## Phase 6 — Product verification

- [!] BLOCKED — 54. Route contract/integration tests pass, but target-specific API output cannot be checked: the local API port 3001 is not listening and deployed settings are unavailable.
- [x] DONE — 55. Read-only SELECT confirms the target occurrence references the exact analysis run and organization.
- [x] DONE — 56. Read-only SELECT confirms the authoritative evidence snapshot belongs to that occurrence and exact run; it is complete/sufficient.
- [!] BLOCKED — 57. Dashboard target status cannot be verified in the live app because local ports 3000 and 3001 are not listening.
- [!] BLOCKED — 58. Findings page target output cannot be verified in the live app because local ports 3000 and 3001 are not listening.
- [!] BLOCKED — 59. History page target output cannot be verified in the live app because local ports 3000 and 3001 are not listening.
- [!] BLOCKED — 60. Report route tests pass, including partial-analysis handling, but a target-specific report cannot be verified without the live API/authenticated app.
- [!] BLOCKED — 61. Live UI/API consistency cannot be verified without the local API/frontend or deployed configuration.

**Final completion:** Not achieved. The job completed, but the analysis is PARTIAL and live product visibility is unverified.

---

# D. FIX AND TEST RULES

For each checklist item, use this exact procedure:

**STEP 1 — INSPECT**
Read the relevant code, configuration, tests, and existing diffs.

**STEP 2 — DIAGNOSE**
State the precise issue and root cause.

**STEP 3 — FIX**
Make the smallest complete correction. Preserve existing architecture and unrelated work.

**STEP 4 — TEST**
Run the focused regression tests and affected typechecks.

**STEP 5 — VERIFY**
Confirm the original issue is actually resolved.

**STEP 6 — CHECKLIST**
Mark the item DONE, BLOCKED, or NOT APPLICABLE with evidence.

**STEP 7 — MOVE ON**
Proceed to the next eligible unchecked item.

Do not mark an item DONE just because its code was edited.

# E. REPOSITORY SAFETY

Repository: `C:\Users\Lenovo\Desktop\BugZero`

Branch: `frontend/mann`

Strict rules:

- Preserve all dirty and untracked files.
- Never use `git reset`, `git clean`, `git stash`, destructive revert, or force push.
- Never stage or commit.
- Do not change dependency manifests or lockfiles.
- Do not change `.env` or `.env.local` without approval.
- Never reveal credentials or secrets.
- Never touch `C:\Users\Lenovo\Desktop\BugZero-Safety-Backup`.
- Do not execute migrations or destructive database operations.
- Do not perform unauthorized database permission changes.
- Do not start the global worker.
- Do not run unrelated services or background processes.
- Reuse existing test fixtures where possible.

# F. FINAL REPORT FORMAT

At the end, provide:

## 1. Checklist summary

- Total items: 61
- DONE: 52
- BLOCKED: 8 (25, 52, 54, 57–61)
- NOT APPLICABLE: 1 (31)
- Remaining unchecked: 0

## 2. Fixes completed

- Checklist items 51–52. Root cause: the SQL-injection analyzer treated an unsupported JSON dependency manifest as unavailable source because it checked `metadata.exists` before filtering unsupported languages. Changed `worker/src/analyzers/security/sql-injection-analyzer.ts` to ignore unsupported languages first, while preserving PARTIAL for missing supported source files. Added focused regression coverage in `worker/tests/security-sql-injection.test.ts`.
- Verification: focused SQL-injection tests 52/52 passed; worker typecheck passed; backend analysis/product/finding-intelligence/report tests 21/21 passed; frontend analysis/history/report tests 6/6 passed. The worker's full 180-test suite passed before this final focused fix. ESLint could not run because the workspace's declared ESLint executable is missing.
- No database changes, migrations, env edits, staging, or commits were made.

## 3. Target analysis

- Analysis ID: `070e87e4-2242-46e2-99a9-7620d5fc8d4a`
- Job ID: `94e79bc7-a7f6-43d3-b2bd-40e9b328c5bc`
- Verified organization: `54ce64c7-a0b1-4d71-aa3c-388863c50256`
- Initial state: `QUEUED`, attempt 0/3, available, no lease.
- Final state: job `COMPLETED`, attempt 1; analysis run `PARTIAL`, completed.
- Was the exact job processed? Yes, through a single-job scoped worker invocation.
- Persisted findings: 1 finding and 1 occurrence.
- Persisted evidence: 1 authoritative snapshot; complete/sufficient, 1 path, 9 nodes, 8 edges.
- Likely cause of PARTIAL: a non-source JSON dependency manifest was misclassified as missing security source. A local code fix and regression tests are complete, but the existing completed job was not rerun.

## 4. Product verification

- API: target-specific HTTP response unverified; contract/integration tests pass (21/21).
- Dashboard: live target status unverified; local API/frontend ports 3001/3000 are not listening.
- Findings: persisted DB finding/evidence verified; live page/API unavailable.
- History: target occurrence/run linkage verified in DB; live page unavailable.
- Reports: route tests pass; target-specific report unavailable without live authenticated API.

## 5. Remaining blockers

- Item 25: deployed provider configuration is inaccessible in this workspace.
- Item 52: the target job is already completed and cannot be rerun without separate authorization to create/requeue a target job. No database changes were made.
- Items 54 and 57–61: local app ports 3000 and 3001 are not listening, and deployed settings/authenticated app access are unavailable.
- Smallest safe next step: authorize a fresh or supported requeued run for the same repository/commit/profile after the local fix, and provide access to the deployed/local authenticated product for end-to-end API/UI verification.

## 6. Git safety

- Branch: `frontend/mann`
- Final Git status: 240 short-status entries (219 tracked paths and 21 untracked path groups).
- Existing changes preserved; untracked directories were not cleaned.
- Nothing staged (0 staged paths).
- Nothing committed.

## 7. Final verdict

**PARTIAL** — The exact job was processed and findings/evidence persisted, and the analyzer bug is fixed locally. The target run remains PARTIAL and live product verification is blocked.

---

# MISSION 11 — execution tracker

The Mission 10 record above is preserved. Mission 11 progress follows `b.md`; update both checklists after each verified item.

## Phase A — Existing fix

- [x] A1. Git status rechecked: branch `frontend/mann`, 241 status entries, 219 tracked paths, 0 staged. Existing dirty and untracked work was preserved.
- [x] A2. Confirmed the source-availability/language-filter fix is present in `worker/src/analyzers/security/sql-injection-analyzer.ts`.
- [x] A3. Verified the supported-language guard precedes `metadata.exists`, so unsupported files are skipped instead of falsely marking the run PARTIAL.
- [x] A4. Confirmed regression coverage asserts a missing `.ts` source still returns PARTIAL with a source-unavailable diagnostic.
- [x] A5. SQL analyzer regression suite passed: 52/52, including both unsupported-file and missing-supported-source cases.
- [x] A6. Full worker suite passed 182/182; worker typecheck passed. A frozen full-workspace install restored the missing workspace link without changing manifests or the lockfile.
- [x] A7. Corrected the integration fixture to represent a genuinely missing supported `.ts` source, rather than treating an unsupported dependency manifest as incomplete. `analysis-job.test.ts` now passes 2/2 and preserves coverage that advisory AI cannot upgrade incomplete deterministic analysis.

## Phase B — Fresh analysis

- [x] B1. Read-only joins verified the original analysis/job, repository, commit, and profile; the original run is PARTIAL and job is COMPLETED.
- [x] B2. Recorded the exact intended target IDs: repository `b9c9c76f-a871-42ba-8977-019f44d37349`, commit `a9199321-4724-4352-ad6f-a1497da82af4`, profile `default` v1, organization `54ce64c7-a0b1-4d71-aa3c-388863c50256`.
- [x] B3. Read-only verification found 5 source-content records for the exact repository/commit; all 5 were present and passed stored-size and SHA-256 integrity checks. Content was not printed.
- [x] B4. Verified the supported path is authenticated `POST /analysis`: it validates membership, repository/commit/profile, then calls transactional `createOrGetActiveWork`; direct DB inserts are unnecessary.
- [x] B5. No analysis-creation API defect found: authentication/analysis route tests passed 7/7 and the supported route creates a durable job. The live configured test identity does not exist in this database; tracked under B6/D2.
- [!] B6. BLOCKED — local `/auth/login` returned 401; read-only checks found zero account rows for the configured test email and user ID. No account was created, reset, or modified.
- [!] B7. BLOCKED — no fresh analysis ID exists because authenticated creation is blocked.
- [!] B8. BLOCKED — no fresh job exists to verify.
- [!] B9. BLOCKED — no fresh job exists to assess for eligibility.

## Phase C — Worker execution

- [x] C1. Scoped CLI parsing/validation is covered by the worker test suite (182/182 passed).
- [!] C2. BLOCKED — no fresh job/organization pair exists until B6 is unblocked.
- [x] C3. Reused Mission 10 read-only verification: the worker uses `DATABASE_QUEUE_URL` with the dedicated non-BYPASSRLS role and the required queue grants.
- [!] C4. BLOCKED — no fresh job exists to inspect for a competing lease.
- [x] C5. Verified the NVIDIA investigator is disabled when its API key is removed: `enabled=false`, `availability=MISSING_CONFIGURATION`; no AI request was made.
- [!] C6. BLOCKED — no fresh eligible job exists because B6 authentication is blocked; no worker was started.
- [!] C7. BLOCKED — no fresh job/lease exists to monitor.
- [!] C8. BLOCKED — no fresh job to inspect for source extraction.
- [!] C9. BLOCKED — no fresh job to inspect for file discovery.
- [!] C10. BLOCKED — no fresh job to inspect for parsing or Code IR.
- [!] C11. BLOCKED — no fresh job to inspect for deterministic analyzer execution.
- [!] C12. BLOCKED — the target SQL fix cannot be exercised without the blocked fresh job.
- [!] C13. BLOCKED — no fresh analyzer results to assess for completeness.
- [!] C14. BLOCKED — no fresh findings/evidence to verify.
- [!] C15. BLOCKED — no fresh job or analysis run exists to verify terminal states.

## Phase D — API

- [x] D1. Started local API (port 3001) and frontend (port 3000); anonymous `/auth/session` returned 401 as expected and `/login` returned 200.
- [!] D2. BLOCKED — configured local test-account inputs do not match any database user (zero rows by email and user ID); login returned 401. An authenticated browser session or valid existing-account credentials are required.
- [!] D3. BLOCKED — fresh analysis creation requires the unavailable authenticated principal.
- [!] D4. BLOCKED — no fresh analysis ID to query.
- [!] D5. BLOCKED — no authenticated target result request.
- [!] D6. BLOCKED — no fresh finding ID to query.
- [!] D7. BLOCKED — no fresh run to verify through the live history route.
- [!] D8. BLOCKED — no fresh run to use for live report generation.
- [x] D9. No live API defect was found; login is blocked by the absent configured account, not the creation route.
- [x] D10. Authentication/analysis route tests passed 7/7; no API defect required a new regression test.

## Phase E — Frontend

- [x] E1. Started frontend locally; `/login` rendered successfully (HTTP 200).
- [!] E2. BLOCKED — no valid existing-account login is available in the configured database/session; the login POST returned 401.
- [!] E3. BLOCKED — no fresh analysis was created.
- [!] E4. BLOCKED — no fresh analysis page to inspect.
- [!] E5. BLOCKED — no authenticated findings page for the fresh run.
- [!] E6. BLOCKED — no authenticated evidence detail to inspect.
- [!] E7. BLOCKED — no fresh run to verify in UI history.
- [!] E8. BLOCKED — no authenticated target report to inspect.
- [!] E9. BLOCKED — browser-level result/network checks depend on logging in and opening a fresh analysis.
- [!] E10. BLOCKED — no live authenticated API/frontend integration could be exercised.
- [!] E11. BLOCKED — browser verification depends on B6/D2 authentication and a fresh analysis.

## Phase F — Final quality

- [x] F1. Full worker suite passed 182/182.
- [x] F2. Backend test suite passed: 44 passed, 0 failed, 2 skipped (46 total).
- [x] F3. Frontend test suite passed: 33/33.
- [x] F4. Backend and frontend typechecks passed.
- [x] F5. `git diff --check` completed cleanly; Git printed only pre-existing CRLF conversion warnings.
- [x] F6. Preserved all pre-existing work; no cleanup or unrelated-file edits were made.
- [x] F7. Verified 0 staged entries (`git diff --cached --quiet`).
- [x] F8. No commits were created.
- [x] F9. Updated this Mission 11 tracker and `b.md` with exact execution results.

---

# FINAL OPERATING INSTRUCTION

Start with checklist item 1.

Complete it, verify it, and mark it.

Then move to item 2.

Continue in order, one item at a time, respecting dependencies and time limits.

Do not dump a huge proposed plan and stop. Actually perform the safe work.

Do not loop forever.

Do not skip verification.

Do not claim success without real end-to-end evidence.

---

# MISSION 12 — AUTHENTICATION BLOCKER DIAGNOSIS

## Phase 1 — Diagnosis

- [x] Inspected the login route, account repository, JWT signing/verification, and frontend session handling.
- [x] Confirmed local API startup loads `../.env.local`; its `DATABASE_URL` connects to database `neondb` at endpoint `ep-green-sun-bdv25vtw` (pooled host). Secrets and full connection values were not printed.
- [x] Confirmed `.neon` links to project `noisy-shape-13318805`, branch `development`, which is archived. That project’s endpoint list contains `ep-snowy-credit-b4uv1tbn` and `ep-odd-hill-b4cxpfs4`, not the endpoint in `.env.local`; the default `production` branch is ready. The Neon management credential is scoped to the linked project, so the owner of the `.env.local` endpoint could not be resolved.
- [x] Executed SELECT-only checks through the existing `.env.local` connection. The configured email, user ID, exact pair, and organization ID each matched 0 rows; the intended target organization, repository, commit, run, and job were present. The latest aggregate check found 2 users, 2 organizations, and 2 memberships; exactly 1 target-organization member has an analysis-eligible role, a nonempty password hash, and a default organization matching the target. An earlier aggregate probe returned 1/1/1; no database writes were made by this task, so the count discrepancy is recorded as possibly concurrent/external activity or connection-context variation. No account details or hash values were retrieved or printed.
- [x] The configured account therefore has no hash, default organization, or membership in this database because its user row is absent. `users`, `organizations`, and `members` have no status-like column; the login contract checks account lookup, scrypt password verification, a default organization, and an existing membership.
- [x] Confirmed `AUTH_DEV_LOGIN_*` values are not referenced by application code; they do not create an account or supply credentials to the login form. `/auth/login` returns the same 401 for a missing account, invalid password/hash, missing default organization, or missing membership.
- [x] The local development private-key file exists and matches `AUTH_PUBLIC_KEY`; token signing configuration is not the observed cause of the configured identity's 401.
- [x] Authentication/session regression tests passed: 5/5.

## Phase 2 — Safe fix status

- [-] No authentication-code defect was found to fix. The route correctly rejects an identity with no matching database user; adding a bypass, creating an account, or resetting credentials would violate the safety requirements.
- [-] Attempt 2 is not applicable: Attempt 1 established a data/configuration mismatch rather than a failed code fix, and the auth/session regression tests pass.
- [x] User confirmed the current `.env.local` endpoint is the intended local database. No environment file was changed; the `.neon` project/branch mismatch is recorded but not used to override the confirmed connection.
- [x] With approval, restarted only the local API and frontend from their project scripts; both loaded the confirmed root `.env.local`. Frontend `/login` returned 200 and anonymous API `/auth/session` returned 401.
- [x] User signed in through the shared browser. The session entry is structurally valid and unexpired; no token or account identifiers were exposed. The active session is not for the target organization.

## Phase 3 — Verification and outcome

- [x] Active API accepted the browser bearer session: `/auth/session` returned 200, with an analysis-eligible role.
- [x] The authenticated `/repositories` endpoint returned 200.
- [!] The returned workspace does not match the target organization; the authenticated repository list contains one non-target repository, and the target repository is not visible. This persisted after restarting the API/frontend from the confirmed `.env.local`; the signed-in account is therefore not the target-organization account.
- [!] User confirmed they do not have access to the existing target-organization account. No authorized target-org identity/session is available to continue.
- [!] Fresh analysis creation, scoped worker execution, target API results, and target frontend display remain blocked. No password was tested or retrieved.

## Root cause and smallest unblock

The configured test login's immediate 401 cause is that its email does not exist in the connected database, so login fails at account lookup before password or membership verification. The identifiers in `AUTH_DEV_LOGIN_*` are stale and are not consumed by the application. The active browser session authenticates successfully but resolves to a different workspace with no target repository access. Read-only checks confirm one analysis-eligible account with a hash and target-org membership exists, but the currently signed-in account is not it. The user confirmed they do not have access to that account.

Smallest safe unblock: an authorized account owner/user must sign in through the supported browser login with the existing target-organization account (or otherwise restore the user's authorized access). Do not share its password or session token. No account or environment changes were made, no fresh analysis was created, and no end-to-end success is claimed.

## G. AUTOMATIC FIX-AND-CONTINUE LOOP (MANDATORY)

You MUST operate in an automatic sequential execution loop.

For every checklist item:

1. Select the next unchecked item whose dependencies are satisfied.
2. Inspect the relevant implementation.
3. Identify the root cause.
4. Implement the complete fix.
5. Add or update regression tests.
6. Run focused tests and relevant typechecks.
7. Verify the result.
8. Update the checklist immediately:
   - [x] DONE — verified successfully.
   - [!] BLOCKED — external permission, approval, or dependency required.
   - [-] NOT APPLICABLE — supported by evidence.
9. Automatically continue to the next eligible unchecked item.

### Loop limits

- Maximum 20 minutes per checklist item.
- Maximum 2 attempts to fix the same root cause.
- Maximum 2 test-fix cycles.
- Never repeat an unchanged failing command.
- Never retry a blocked external operation automatically.
- Split oversized items into smaller checklist items.
- Keep a concise progress log.

### Important behavior

Do not stop after completing one item.

Do not ask me whether to continue after every item.

Do not merely describe the next steps.

Continue executing all safe, independent checklist items automatically until:
- All checklist items are complete;
- Remaining items are genuinely blocked; or
- A safety-critical issue requires my approval.

If one item is blocked, mark it BLOCKED and continue with other independent items. Do not bypass dependencies.

At the end, provide the complete updated checklist and final report.

**The loop must be bounded, sequential, and self-terminating. Never run indefinitely.**

---

# MISSION 13 — AUTHORIZED DEVELOPMENT ACCESS

## Verified findings

- [x] The existing browser signup page calls the current backend auth service; `POST /auth/signup` and its `/auth/register` alias create a user, a new organization/workspace, and an OWNER membership transactionally, then issue the ordinary signed session.
- [x] Existing backend regression tests verify registration, normalized email, password hashing/verification, owner role, login, and session behavior. Backend auth tests passed 14/14; frontend auth/API-client tests passed 20/20.
- [x] No invitation, organization-join, or membership-management route is exposed by the backend. Signup creates a separate workspace; it does not grant access to the existing target organization. `MemberRepository.create` is internal repository code, not an authorized user-facing invitation flow.
- [x] The implementation uses Ed25519 JWTs and Node `scrypt` password hashes, not bcrypt. This existing compatible scheme was preserved; switching hash formats would risk breaking existing credentials.

## Status and approval required

- [x] Tests were isolated/mocked. No live signup, database write, account creation, environment change, or worker execution was performed. The live onboarding test was not run because it writes records and starts a worker.
- [!] A self-registered user would only receive a new independent workspace, so this does not establish access to the target organization/repository or unblock the Mission 12 analysis.
- [!] BLOCKED — a target-organization OWNER/ADMIN must explicitly approve adding the user's own account to that organization and specify the intended role. The repository has no invitation/join route to perform this safely; an authorized membership-provisioning path or separate approval to implement one is also required. Do not use direct SQL or bypass tenant authorization.
- [!] No new development account or target-organization membership was created. No fresh analysis was submitted and no worker was started.

Smallest safe next step: obtain target-organization OWNER/ADMIN approval for the user's membership and role, then authorize/enable an application-supported invitation or membership-provisioning path. The user can self-register through `/signup` with an email they control, but that alone creates a separate workspace and will not satisfy target-repository access. Do not send passwords or session tokens.

# MISSION 14 — SECURE ORGANIZATION INVITATIONS

## Implementation and security checks

- [x] Added a code-only migration for organization-scoped invitations with constrained roles/statuses, unique pending invitations per organization/email, token-hash uniqueness, and tenant RLS. The migration was not applied to any database.
- [x] Added authenticated OWNER/ADMIN-only create/list routes. The service and repository both enforce manager authorization; invited roles are restricted to DEVELOPER, SECURITY_REVIEWER, and VIEWER.
- [x] Invitation tokens use 32 cryptographically random bytes; only a SHA-256 digest is persisted. Listing does not return tokens. Acceptance checks the authenticated account email, expiration, and pending status, and locks the invitation row while accepting it transactionally.
- [x] Acceptance creates membership through the repository, preserves an existing membership role, switches the user's default organization, and returns a session scoped to the invited organization. Caller-supplied organization IDs are bound to token lookup and explicit organization predicates.
- [x] Repository create/list/accept operations now require an active tenant context matching the operation's organization. Regression coverage confirms missing and mismatched contexts are rejected before database access.
- [x] Added invitation creation/listing UI and acceptance UI. The token stays in the URL fragment before acceptance and is submitted in an authenticated request body; it is not placed in the request URL. No email-delivery provider exists, so an OWNER/ADMIN must send the copied link only to its bound email address.
- [x] Database package tests passed: 20/20, including 7 invitation repository tests. Backend invitation API tests passed: 7/7. Frontend API/navigation tests passed: 21/21. Backend, frontend, and database typechecks passed.
- [x] Static tests cover unauthorized managers, cross-organization scoping, prohibited roles, expiration, replay, email mismatch, existing memberships, token handling, tenant-context mismatch, and competing accept requests. The repository acceptance query uses `SELECT ... FOR UPDATE`.

## Remaining verification and external blockers

- [!] BLOCKED — No live PostgreSQL concurrency/migration test was run because the configured database is the target environment and no approval was given to apply a migration or create an invitation, account, or membership. The migration must be applied through an authorized migration process before the feature is available.
- [!] BLOCKED — The user has no target-organization account credentials. A target-organization OWNER/ADMIN must create an invitation for the user's own email and send the link to that address; the invitee can then register/sign in with that email and accept it.
- [!] No live invitation, account, membership, fresh analysis, or worker execution occurred. Target organization/repository access and the fresh-analysis API/frontend workflow remain unverified.
- [!] Prior read-only diagnostics found the configured application database role has `BYPASSRLS`; therefore RLS is not an enforcement boundary for that role. The new repository adds tenant-context checks and explicit organization filters, but changing database roles/grants requires separate approval and was not attempted.
- [!] ESLint was not rerun; the earlier Mission 14 attempt could not find the declared backend ESLint executable.

**Status:** Invitation implementation and targeted regressions are complete in source. Mission 14's final objective—legitimate live target-organization access followed by fresh analysis processing—is not complete until an authorized OWNER/ADMIN applies the migration, issues the invitation, and the invitee accepts it. No end-to-end success is claimed.