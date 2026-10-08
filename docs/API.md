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

`GET /analysis/:runId` returns run status, latest job status/stage/attempt/timestamps, progress metrics from run coverage, and a sanitized failure indicator. Both endpoints require a trusted authentication adapter; the API checks that the authenticated user is a member of the derived organization. Analysis requests require OWNER, ADMIN, DEVELOPER, or SECURITY_REVIEWER membership. VIEWER members may read status but cannot request analysis.

## Runtime and limitations

`createApiServer` and `startApiServer` require an `authenticate(request)` adapter that returns a verified user and organization context. By default, the executable API uses `jose` to verify EdDSA JWT signatures against the Ed25519 key in `AUTH_PUBLIC_KEY`, and validates `iss=bugzero-auth` and `aud=bugzero-api`; a trusted custom module can be selected with `AUTH_ADAPTER_MODULE`. The development-only issuer is initialized with `pnpm --filter @bugzero/api dev-auth:setup`; it stores its Ed25519 private key outside the repository at `~/.bugzero/dev-auth/ed25519-private.pem` and writes the corresponding public key to the ignored root `.env.local` as `AUTH_PUBLIC_KEY`, alongside `AUTH_ISSUER=bugzero-auth` and `AUTH_AUDIENCE=bugzero-api`. Generate a short-lived token with `pnpm --filter @bugzero/api dev-auth:token -- --sub <user-uuid> --org <organization-uuid>`. Tokens use UUID `sub` (user) and `org` (organization) claims, plus `iss`, `aud`, `iat`, and `exp`; API membership/role checks remain authoritative.

This development issuer is not a production identity provider. No external or production issuer, signer, or identity provider is implemented in this repository; deployments must provide their own trusted authentication integration. The frontend demo token is not valid API authentication, and caller-supplied organization identifiers are never trusted. `REDIS_URL` is required and shared with the worker through `@bugzero/config`; there is no localhost fallback.

The API queue adapter imports only the canonical queue transport from the worker package; it does not import or execute `AnalysisJobProcessor`. The actual source processing remains worker-only. Live PostgreSQL/Redis and API-to-worker E2E behavior remain unverified.

## Product read operations

The current product routes are:

- `GET /repositories`
- `GET /repositories/:repositoryId`
- `GET /repositories/:repositoryId/history`
- `GET /repositories/:repositoryId/findings`
- `GET /findings/:findingId` (includes the selected occurrence, evidence graph, and risk assessments)
- `GET /repositories/:repositoryId/health`
- `GET /repositories/:repositoryId/reports` (persisted report summaries)

Repository registration/ingestion is not yet exposed through an API operation. Reports can be listed, but report generation/download is not implemented.
