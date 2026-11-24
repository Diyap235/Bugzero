# BugZero API workspace

The Fastify API implements persisted account/workspace onboarding, authenticated analysis dispatch/status, tenant-scoped product reads, and bounded local ZIP repository ingestion. The analysis endpoint validates a request, checks organization membership and role, resolves an indexed repository commit and analysis profile, and transactionally creates or reuses the PostgreSQL run/job rows. The durable `analysis_jobs` row is consumed by polling workers.

## Runtime requirements

- `DATABASE_URL` for Neon PostgreSQL product data.
- `DATABASE_URL_UNPOOLED` for migration execution only.
- Local development uses the built-in `jose` EdDSA JWT verifier. Initialize the development keypair and local environment with `pnpm --dir backend dev-auth:setup`, then start the API with `pnpm --dir backend dev`.
- The setup command creates an Ed25519 keypair, writes only the public key to the ignored root `.env.local`, and keeps the signing key outside the repository at `~/.bugzero/dev-auth/ed25519-private.pem`. The API verifies signed JWTs with `AUTH_PUBLIC_KEY`; local account registration/login signs with the matching external development key. Production must provide the matching `AUTH_PRIVATE_KEY` through a secret manager and must never commit it.
- The local API development command starts one managed analysis queue consumer automatically. It shares a PostgreSQL advisory lock with standalone workers to prevent duplicate consumers, stops with the API, and retries startup after transient worker failures. The consumer requires `DATABASE_QUEUE_URL` for pooled queue queries and `DATABASE_QUEUE_LOCK_URL` for a dedicated direct, unpooled lock session; the API itself remains available if the worker cannot start. Production API deployments do not start an in-process worker; run the worker service separately.
- `POST /auth/signup` creates a persisted user, organization/workspace, and OWNER membership in one PostgreSQL transaction. Passwords are persisted as scrypt hashes. `POST /auth/login` verifies persisted credentials and membership, then issues a short-lived Ed25519 JWT with UUID `sub` and `org` claims. `GET /auth/session` validates the signed identity against current tenant membership and returns its persisted workspace. The verifier, issuer, audience, and tenant membership checks remain authoritative. `/auth/register` remains a compatible alias for signup.
The API verifies the JWT signature and never trusts organization IDs supplied by callers. The browser stores the signed session and sends it only to the same-origin API proxy. Runtime startup rejects missing, malformed, or non-Neon `DATABASE_URL` values; it does not fall back to a local database server.

## Routes

- `POST /auth/signup` — create an account, workspace, and OWNER membership; return a signed session.
- `POST /auth/register` — compatible alias for signup.
- `POST /auth/login` — verify a persisted password and workspace membership; return a signed session.
- `GET /auth/session` — validate the bearer token and return the user's persisted workspace and membership.
- `POST /organizations/invitations` — OWNER/ADMIN-only, create an email-bound seven-day invitation with a one-time token.
- `GET /organizations/invitations` — OWNER/ADMIN-only, list invitation status without exposing tokens.
- `POST /organizations/invitations/accept` — accept a matching email invitation and issue a session for the invited organization.
- `POST /analysis` — create or reuse an analysis run/job in PostgreSQL.
- `GET /analysis/:runId` — retrieve sanitized analysis status/progress.
- `POST /repositories/local-zip` — validate and persist a bounded local ZIP snapshot. This is the only repository-ingestion endpoint exposed by the MVP.
- `GET /repositories` and `GET /repositories/:repositoryId` — list and inspect repositories.
- `GET /repositories/:repositoryId/history` — analysis history.
- `GET /repositories/:repositoryId/findings` and `GET /findings/:findingId` — findings, current occurrence, evidence graph, risk assessments, and any validated advisory AI investigation for the selected occurrence/evidence.
- `GET /repositories/:repositoryId/health` — health snapshot history.
- `GET /repositories/:repositoryId/reports` — list persisted report summaries.
- `POST /repositories/:repositoryId/reports` — generate or retrieve an idempotent JSON report for a completed or partial analysis run.
- `GET /reports/:reportId` — retrieve a tenant-scoped persisted report document.

Reports are built only from persisted run, finding, evidence, and health records. AI investigation text is explicitly advisory. Missing scores/descriptions remain Unknown, and a Partial analysis remains labeled Partial. The web workspace offers PDF, JSON, and findings CSV downloads from the same report document. The API, worker, and database migration scripts load the root `.env.local` when present; hosting platforms can inject variables directly without that file. The migration runner requires `DATABASE_URL_UNPOOLED`. Optional advisory code review uses worker-only `NVIDIA_API_KEY` and `NVIDIA_MODEL`; deterministic analysis does not require them. See [deployment and environment setup](../docs/DEPLOYMENT.md) and [the backend completion checklist](../docs/BACKEND_COMPLETION_CHECKLIST.md). Apply all forward migrations before using the current analysis pipeline against an existing database.
