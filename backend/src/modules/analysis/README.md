# Analysis API module

## Implemented

- `POST /analysis` validates `CreateAnalysisRequestSchema`, derives organization/user from the required trusted authentication adapter, verifies membership and a request-capable role, verifies the tenant-scoped repository and exact indexed commit, resolves the existing analysis profile, creates or reuses active work, and returns `202 Accepted`.
- Run and job creation is atomic in `AnalysisRepository.createOrGetActiveWork`. Identity includes organization, repository, commit, profile/version, and scope; concurrent requests serialize through a PostgreSQL advisory transaction lock.
- The committed PostgreSQL `analysis_jobs` row is the durable work item; API code never imports or calls `AnalysisJobProcessor`.
- On enqueue error, both job and run are marked `FAILED` and run coverage records `QUEUE_ENQUEUE_FAILED`; the endpoint returns 503. If failure-state persistence itself fails, the API returns 500.
- `GET /analysis/:runId` returns tenant-authorized run status, latest job state/stage/attempt/timestamps, persisted progress, and a sanitized failure indicator.

## Verified

- The module does not implement credential/token authentication. The executable API always uses the built-in Ed25519 JWT verifier configured with `AUTH_PUBLIC_KEY`, `AUTH_ISSUER`, and `AUTH_AUDIENCE`. The resolver verifies identity and derives organization context from trusted authentication state. Membership and role checks are enforced after that resolver.
- Live end-to-end verification for the PostgreSQL-only queue migration remains outstanding. Tenant RLS isolation is enforced by the `onRoute` hook in `createApiServer` via `withOrganizationContext`.
- Only the current single built-in Structural/Quality analyzer profile is accepted by the API.

Analysis source is never opened or executed in the API. Processing remains in the worker.
