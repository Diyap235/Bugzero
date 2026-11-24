# MISSION 11 — BUGZERO MAKE-IT-WORK MISSION
## Mandatory implementation, repair, execution and end-to-end verification

You are not performing another audit. You are responsible for making BugZero's analysis pipeline work.

**Your primary responsibility is to FIX the remaining problems, not just identify or report them.**

You must inspect, implement, test, execute, verify, and continue automatically until the application works end to end or a genuine external restriction makes further progress impossible.

---

# 1. NON-NEGOTIABLE OBJECTIVE

Mission 10 established that:

- The original analysis job completed.
- The original analysis remained PARTIAL.
- One finding, one occurrence, and one complete/sufficient evidence snapshot were persisted.
- A SQL analyzer bug was identified and fixed locally.
- The fix has regression coverage.
- The original completed job cannot simply be executed again.

Your mission is to prove the fix using a fresh analysis and resolve any additional problems discovered.

### Required final outcome

A fresh BugZero analysis must:

1. Be created through the supported application workflow.
2. Use the intended repository, commit, analysis profile, and organization.
3. Be processed by the correct scoped worker.
4. Complete parsing and deterministic analysis.
5. Correctly handle unsupported dependency manifests.
6. Persist findings, occurrences, and evidence.
7. Reach the correct successful terminal state.
8. Return correct results through the API.
9. Display those results correctly in the frontend.

Passing tests without a real successful analysis is NOT completion.

# 2. MANDATORY AUTOMATIC FIX LOOP

You MUST keep working automatically.

For every issue discovered:

**INSPECT → DIAGNOSE → IMPLEMENT FIX → ADD TEST → RUN TESTS → VERIFY → MARK DONE → NEXT ISSUE**

Rules:

- Complete one checklist item at a time.
- Do not ask me whether to continue after each item.
- Do not stop after identifying a problem.
- Do not provide a proposed fix instead of implementing it.
- Do not mark an issue complete before verifying it.
- Automatically continue to the next eligible checklist item.
- If a fix reveals another problem, add it to the checklist and resolve it.
- Preserve completed work while fixing subsequent issues.

### Bounded execution

- Maximum 20 minutes per checklist item.
- Maximum 2 attempts per root cause.
- Maximum 2 test-fix cycles.
- Do not repeat unchanged failing commands.
- Divide oversized items into smaller tasks.
- Do not loop indefinitely.
- Do not waste time repeatedly retrying external services.

If an external restriction blocks one item, record the exact reason and continue with independent implementation and testing.

Do not use BLOCKED as an excuse to avoid work that can safely be completed locally.

# 3. PROJECT SAFETY

Repository:

`C:\Users\Lenovo\Desktop\BugZero`

Branch:

`frontend/mann`

Preserve all existing changes.

Never:
- Use `git reset`, `git clean`, `git stash`, destructive revert, or force push.
- Stage or commit files.
- Overwrite unrelated dirty or untracked files.
- Modify dependency manifests or lockfiles.
- Change `.env` or `.env.local` without approval.
- Expose secrets, tokens, passwords, or connection strings.
- Touch `C:\Users\Lenovo\Desktop\BugZero-Safety-Backup`.
- Execute destructive database operations or migrations.
- Modify production roles, grants, memberships, RLS policies, or database permissions without approval.
- Start the global worker.
- Process unrelated jobs.
- Send repository source to external AI providers without explicit authorization.

Use existing project architecture and existing dependencies.

# 4. MASTER EXECUTION CHECKLIST

Maintain this checklist in `a.md`, preserving the existing Mission 10 history.

Update each item immediately after verification.

## PHASE A — EXISTING FIX

- [x] A1. Inspected status: branch `frontend/mann`, 241 status entries, 219 tracked paths, 0 staged; preserved existing changes.
- [x] A2. Confirmed the source-availability/language-filter fix is present in `worker/src/analyzers/security/sql-injection-analyzer.ts`.
- [x] A3. Verified the supported-language guard precedes `metadata.exists`, so unsupported files are skipped instead of falsely marking the run PARTIAL.
- [x] A4. Confirmed regression coverage asserts a missing `.ts` source still returns PARTIAL with a source-unavailable diagnostic.
- [x] A5. SQL analyzer regression suite passed: 52/52, including both unsupported-file and missing-supported-source cases.
- [x] A6. Full worker suite passed 182/182; worker typecheck passed. A frozen full-workspace install restored the missing workspace link without changing manifests or the lockfile.
- [x] A7. Corrected the integration fixture to represent a genuinely missing supported `.ts` source, rather than treating an unsupported dependency manifest as incomplete. `analysis-job.test.ts` now passes 2/2 and preserves coverage that advisory AI cannot upgrade incomplete deterministic analysis.

Do not rewrite working code unnecessarily.

## PHASE B — CREATE A FRESH ANALYSIS

- [x] B1. Read-only joins verified the original analysis/job, repository, commit, and profile; the original run is PARTIAL and job is COMPLETED.
- [x] B2. Recorded the exact intended target IDs: repository `b9c9c76f-a871-42ba-8977-019f44d37349`, commit `a9199321-4724-4352-ad6f-a1497da82af4`, profile `default` v1, organization `54ce64c7-a0b1-4d71-aa3c-388863c50256`.
- [x] B3. Read-only verification found 5 source-content records for the exact repository/commit; all 5 were present and passed stored-size and SHA-256 integrity checks. Content was not printed.
- [x] B4. Verified the supported path is authenticated `POST /analysis`: it validates membership, repository/commit/profile, then calls transactional `createOrGetActiveWork`; direct DB inserts are unnecessary.
- [x] B5. No analysis-creation API defect found: authentication/analysis route tests passed 7/7 and the supported route creates a durable job. The live configured test identity does not exist in this database; tracked under B6/D2.
- [!] B6. BLOCKED — local `/auth/login` returned 401; read-only checks found zero account rows for the configured test email and user ID. No account was created, reset, or modified.
- [!] B7. BLOCKED — no fresh analysis ID exists because authenticated creation is blocked.
- [!] B8. BLOCKED — no fresh job exists to verify.
- [!] B9. BLOCKED — no fresh job exists to assess for eligibility.

Do not reuse the old completed job.

Do not manually insert database rows.

Do not fake a new analysis by changing status fields.

If analysis creation fails, FIX the actual application problem and retry within the bounded limits.

## PHASE C — WORKER EXECUTION

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

If the worker fails, do not merely report the error.

Trace the failure, implement the smallest correct fix, add regression tests, and execute the safe recovery again.

Never start the global worker.

## PHASE D — FIX API PROBLEMS

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

Do not ask me to recreate the existing test account.

Never expose credentials or tokens.

## PHASE E — FIX FRONTEND PROBLEMS

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

Reading frontend source code does not count as live UI verification.

## PHASE F — FINAL QUALITY

- [x] F1. Full worker suite passed 182/182.
- [x] F2. Backend test suite passed: 44 passed, 0 failed, 2 skipped (46 total).
- [x] F3. Frontend test suite passed: 33/33.
- [x] F4. Backend and frontend typechecks passed.
- [x] F5. `git diff --check` completed cleanly; Git printed only pre-existing CRLF conversion warnings.
- [x] F6. Preserved all pre-existing work; no cleanup or unrelated-file edits were made.
- [x] F7. Verified 0 staged entries (`git diff --cached --quiet`).
- [x] F8. No commits were created.
- [x] F9. Updated `a.md` and this tracker with exact execution results.

# 5. FIX-IT REQUIREMENT

When you encounter a problem, you must distinguish between:

**A. Code problem**

You have authority to inspect and fix it.

Examples:
- Incorrect SQL.
- Broken queue processing.
- Incorrect status transitions.
- Parser failures.
- Analyzer bugs.
- Missing evidence persistence.
- Incorrect API responses.
- Frontend rendering defects.
- Incorrect validation.
- Broken integration between modules.

Fix these directly, with regression tests.

**B. Configuration or environment problem**

Investigate it and implement any safe local code/config validation improvements.

If an actual secret, external dashboard permission, production database permission, or user approval is required, do not fabricate access or bypass security.

Explain the exact external action needed.

Continue fixing other independent code problems.

**C. Data integrity problem**

Never fabricate data, force statuses, delete historical records, or manually mark an analysis successful.

Use supported application workflows and preserve historical records.

# 6. RETRY AND RECOVERY POLICY

If fresh analysis creation fails:
- Diagnose the application/API failure.
- Fix it.
- Test it.
- Retry the supported workflow within the retry limit.

If worker execution fails:
- Diagnose the exact worker stage.
- Fix the code.
- Test it.
- Retry only the eligible exact job through scoped execution.

If analysis becomes PARTIAL:
- Inspect every analyzer and parser status.
- Identify which component caused incompleteness.
- Fix that component.
- Create another fresh analysis if the previous job has already completed.
- Do not rewrite historical analysis results.

If API verification fails:
- Diagnose the route, authorization, repository, and serialization paths.
- Fix the underlying issue.
- Repeat API tests.

If frontend verification fails:
- Diagnose the actual browser error or incorrect response handling.
- Fix it.
- Repeat live UI verification.

Do not leave a known fix unverified if a safe verification path exists.

# 7. DEFINITION OF SUCCESS

You may declare SUCCESS only when:

- A fresh analysis has been created.
- The exact new job has been processed using scoped execution.
- The SQL analyzer fix has been exercised.
- The analysis has completed successfully, not PARTIAL.
- Results and evidence are persisted.
- API responses are correct.
- Frontend displays consistent results.
- No unrelated jobs were processed.

A legitimate zero-finding result is acceptable if analysis completed correctly.

# 8. FINAL REPORT

Provide:

### Checklist
- Total:
- DONE:
- BLOCKED:
- NOT APPLICABLE:
- Remaining:

### Fresh analysis
- Analysis ID:
- Job ID:
- Repository:
- Commit:
- Profile:
- Organization:
- Final analysis status:
- Final job status:

### Execution
- Files discovered:
- Files parsed:
- Parse diagnostics:
- Analyzer statuses:
- Findings:
- Occurrences:
- Evidence snapshots:
- Evidence completeness:

### Verification
- Worker tests:
- Backend tests:
- Frontend tests:
- Typechecks:
- API verification:
- Browser verification:

### Fixes
- Every root cause discovered.
- Every file changed.
- Every fix implemented.
- Regression coverage.

### Safety
- Git branch and status.
- Existing changes preserved.
- Nothing staged.
- Nothing committed.
- No unauthorized database changes.

### Verdict

Choose exactly one:

- SUCCESS — The fresh analysis completed and actual product results were verified.
- PARTIAL — Some work succeeded, but a completion requirement remains unverified.
- BLOCKED — An external restriction prevents further safe progress.

# FINAL COMMAND

**DO NOT STOP AT DIAGNOSIS. FIX THE PROBLEM.**

Start with A1.

---

# MISSION 12 FOLLOW-UP — AUTHORIZATION BLOCKER

- [x] The configured test identity is absent from the connected database; the login request fails at user lookup. `AUTH_DEV_LOGIN_*` values are unused by the application.
- [x] The active browser session is valid but belongs to a different workspace; the target repository is not available in its repository list.
- [x] The user confirmed they do not have access to the existing target-organization account. No authorized target-org identity/session is available.
- [!] Fresh analysis creation, scoped worker processing, and target API/frontend verification remain blocked. No authentication bypass, account change, environment edit, or database write was performed.
- [ ] Smallest safe unblock: an authorized account owner/user signs in through the supported browser login with the existing target-organization account or restores the user's authorized access. Do not share credentials or session tokens.

Detailed diagnosis and Mission 12 verification are recorded in [a.md](./a.md). Mission 11 implementation and test history above remains unchanged.

Complete one checklist item, verify it, update `a.md`, and automatically move to the next eligible item.

Continue the bounded fix-and-verify loop until the fresh analysis works end to end or a genuine external approval/permission restriction prevents further progress.

Do not ask me to continue after each item.

Do not simply tell me what I should do next.

---

# MISSION 13 FOLLOW-UP — DEVELOPMENT ACCESS

- [x] Existing `/signup` flow and `/auth/signup` endpoint are verified by existing backend and frontend regression tests (14/14 backend auth tests; 20/20 frontend auth/API-client tests).
- [x] Signup provisions a new independent workspace and OWNER membership; no invitation/join endpoint exists for the existing target organization.
- [x] Existing auth uses Ed25519 JWT plus scrypt password hashes (not bcrypt); no auth scheme changes were made.
- [!] BLOCKED — target-org OWNER/ADMIN approval is required to add the user's account and choose its role, and an authorized membership-provisioning path must be provided or approved for implementation.
- [!] No live account/membership/database changes, fresh analysis, or worker execution occurred.

See the detailed Mission 13 findings and test evidence in [a.md](./a.md). Mission 11/12 history above remains intact.

Do the implementation work yourself wherever authorized and technically possible.

Do not claim success without real evidence.

# 9. TWO-ATTEMPT RULE + SIMPLER REBUILD STRATEGY (MANDATORY)

For every technical problem, follow this exact recovery strategy.

## ATTEMPT 1 — ROOT-CAUSE FIX

1. Inspect the failing implementation.
2. Identify the actual root cause.
3. Implement the smallest correct fix.
4. Add or update regression tests.
5. Run the relevant tests and typechecks.
6. Verify the original failure is resolved.

If successful, mark the checklist item DONE and continue.

## ATTEMPT 2 — ALTERNATIVE FIX

If Attempt 1 fails:

1. Re-examine the failure and test results.
2. Determine why the first solution did not work.
3. Try one genuinely different implementation approach.
4. Keep existing contracts and required behavior intact.
5. Add regression tests.
6. Run tests and typechecks again.
7. Verify the result.

Do not simply repeat the first fix with superficial changes.

## AFTER TWO FAILED ATTEMPTS — SIMPLIFY OR REBUILD

If both attempts fail, you MUST evaluate whether the problematic component should be rebuilt using a simpler approach.

Follow these steps:

1. Identify the smallest failing component or boundary.
2. Inspect its callers, interfaces, contracts, database dependencies, and tests.
3. Identify which existing behavior must be preserved.
4. Design a simpler implementation that removes unnecessary complexity.
5. Prefer deterministic, explicit, maintainable code over complicated abstractions.
6. Reuse existing project dependencies and established architecture.
7. Replace or refactor only the problematic component.
8. Add tests for normal behavior, failure behavior, edge cases, and integration.
9. Run affected package tests and typechecks.
10. Verify that existing callers and integrations still work.
11. Update the checklist with the rebuild and its verification evidence.

### Rebuild principles

- Rebuild the smallest necessary component, not the entire application.
- Do not introduce a second competing implementation.
- Do not leave obsolete code paths active.
- Do not break existing API contracts or database schemas.
- Do not remove security, authorization, tenant isolation, evidence integrity, or lease protection.
- Do not simplify by removing required functionality.
- Do not modify production database structures or permissions without approval.
- Do not add dependencies or modify lockfiles.
- Preserve historical data and existing user work.

### If the simpler rebuild also fails

Do not continue making random changes.

Record:
- Both failed attempts.
- Why each approach failed.
- The proposed simpler architecture.
- What remains technically or externally blocked.
- The smallest next action needed.

Continue with independent checklist items.

## REQUIRED CHECKLIST STATUS

Use these states:

- [ ] NOT STARTED
- [~] IN PROGRESS
- [x] DONE — verified
- [R] REBUILT — simpler implementation verified
- [!] BLOCKED — genuine external restriction
- [-] NOT APPLICABLE — evidence provided

**IMPORTANT: Two failed attempts mean change the approach, not abandon the project. Rebuild the smallest problematic component when technically safe and continue toward the end-to-end success criteria.**

# MISSION 14 — SECURE ORGANIZATION INVITATIONS

- [x] Implemented source migration, tenant-scoped invitation repository, authenticated OWNER/ADMIN create/list routes, email-bound single-use acceptance, role restrictions, random bearer tokens with digest-only storage, and invitation frontend flows.
- [x] Reviewed tenant isolation: repository operations require a matching active organization context and use explicit organization predicates. The configured app role's `BYPASSRLS` status is a known limitation; no database role or permission changes were made.
- [x] Verification passed: database tests 20/20, backend invitation tests 7/7, frontend API/navigation tests 21/21, and backend/frontend/database typechecks.
- [!] Migration not applied and no live invitation/account/membership was created. No fresh analysis or worker run occurred; database concurrency and UI behavior against the live target remain unverified.
- [!] BLOCKED — A target-organization OWNER/ADMIN must apply the migration through an authorized process, create an invitation for the user's email, and securely send the one-time link. The user can then sign in/register with that email and accept it. Email delivery is manual because the app has no configured mail provider.

Detailed evidence and outstanding safety limitations are in [a.md](./a.md). Mission 10–13 history remains preserved; no files were staged or committed.