# API runtime

## Analysis request

`POST /analysis` accepts the shared `CreateAnalysisRequestSchema`:

```json
{
  "repositoryId": "UUID",
  "commitSha": "40- or 64-character Git object ID",
  "profileId": "default",
  "scope": "COMMIT",
  "changedFiles": [],
  "changedEntityIds": []
}
```

The API derives organization and user from a trusted authentication adapter, checks membership and role, loads the tenant-scoped repository and indexed commit, resolves the existing analysis profile (creating the configured default profile if needed), atomically creates or reuses active run/job work, and enqueues `{ "organizationId": "...", "jobId": "..." }`. It returns **202 Accepted** with `analysisRunId`, `jobId`, and queued job `status`. It does not parse source or run analysis synchronously.

If the indexed commit is unavailable, the endpoint returns 404 rather than selecting another revision. If Redis enqueue fails, the API marks the job and run `FAILED`, records an enqueue failure code in run coverage, and returns 503. A failure to persist that state is logged and returns 500.

Repeated requests for the same organization, repository, commit, profile version, and scope reuse existing active work. Once prior work is terminal, an explicit repeated request can create a new run.

## Status

`GET /analysis/:runId` returns run status, latest job status/stage/attempt/timestamps, progress metrics from run coverage, including safe AI investigation counts/status, and a sanitized failure indicator. It does not return prompts or source context. Both endpoints require a trusted authentication adapter; the API checks that the authenticated user is a member of the derived organization. Analysis requests require OWNER, ADMIN, DEVELOPER, or SECURITY_REVIEWER membership. VIEWER members may read status but cannot request analysis.

## Runtime and limitations

`createApiServer` and `startApiServer` require an `authenticate(request)` adapter that returns a verified user and organization context. By default, the executable API uses `jose` to verify EdDSA JWT signatures against `AUTH_PUBLIC_KEY`, and validates `iss=bugzero-auth` and `aud=bugzero-api`; a trusted custom module can be selected with `AUTH_ADAPTER_MODULE`. Run `pnpm --filter @bugzero/api dev-auth:setup` locally to create an Ed25519 keypair, store its private key outside the repository at `~/.bugzero/dev-auth/ed25519-private.pem`, and write the public key to the ignored root `.env.local`. First-party registration/login issues short-lived JWTs with UUID `sub` (user) and `org` (workspace) claims. Production must supply the matching `AUTH_PRIVATE_KEY` from a secret manager. API membership and role checks remain authoritative.

`POST /auth/signup` persists the new user, scrypt password hash, workspace, and OWNER membership atomically. The signup form derives a workspace name from the supplied name; the account and workspace are created together. `POST /auth/register` remains an API-compatible alias. `POST /auth/login` verifies the stored scrypt hash and the user's persisted workspace membership before signing a token. `GET /auth/session` verifies the JWT and confirms that its user still belongs to the token's organization before returning persisted workspace details. Caller-supplied organization identifiers are never trusted. `REDIS_URL` is required and shared with the worker through `@bugzero/config`; there is no localhost fallback.

The API queue adapter imports only the canonical queue transport from the worker package; it does not import or execute `AnalysisJobProcessor`. The actual source processing remains worker-only. Live PostgreSQL/Redis and API-to-worker E2E behavior have been verified locally (2026-10-08); see `apps/api/tests/integration/live-backend.test.ts`.

## Product read operations

The current product routes are:

- `POST /repositories/local-zip` (OWNER, ADMIN, or DEVELOPER; bounded and validated ZIP snapshot upload; the sole MVP ingestion method)
- `GET /repositories`
- `GET /repositories/:repositoryId`
- `GET /repositories/:repositoryId/history`
- `GET /repositories/:repositoryId/findings`
- `GET /findings/:findingId` (includes the selected occurrence, evidence graph, risk assessments, and validated advisory AI investigation records tied to that occurrence/evidence snapshot)
- `GET /repositories/:repositoryId/health`
- `GET /repositories/:repositoryId/reports` (persisted report summaries)

Reports can be listed, but report generation/download is not implemented.

The optional worker-only Groq investigator is configured with `GROQ_API_KEY` and `GROQ_MODEL`. It runs after deterministic analysis for persisted findings, and is not required for analysis. Its structured output is advisory and cannot modify findings, evidence, risk, or run status. Provider failures are isolated and replay reuses the persisted result for the same occurrence, evidence, model, and prompt version. See [ADR-007](adr/ADR-007-ai-boundary.md) and [SECURITY.md](SECURITY.md).
