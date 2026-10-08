# BugZero API workspace

The Fastify API implements persisted account/workspace onboarding, authenticated analysis dispatch/status, tenant-scoped product reads, and bounded local ZIP repository ingestion. The analysis endpoint validates a request, checks organization membership and role, resolves an indexed repository commit and analysis profile, creates or reuses run/job work in PostgreSQL, and enqueues the job through BullMQ/Redis.

## Runtime requirements

- `DATABASE_URL` for PostgreSQL.
- `REDIS_URL` shared with the worker.
- Local development uses the built-in `jose` EdDSA JWT verifier. Initialize the development keypair and local environment with `pnpm --filter @bugzero/api dev-auth:setup`, then start the API with `pnpm --filter @bugzero/api dev`.
- The setup command creates an Ed25519 keypair, writes only the public key to the ignored root `.env.local`, and keeps the signing key outside the repository at `~/.bugzero/dev-auth/ed25519-private.pem`. The API verifies signed JWTs with `AUTH_PUBLIC_KEY`; local account registration/login signs with the matching external development key. Production must provide the matching `AUTH_PRIVATE_KEY` through a secret manager and must never commit it.
- `POST /auth/signup` creates a persisted user, organization/workspace, and OWNER membership in one PostgreSQL transaction. Passwords are persisted as scrypt hashes. `POST /auth/login` verifies persisted credentials and membership, then issues a short-lived Ed25519 JWT with UUID `sub` and `org` claims. `GET /auth/session` validates the signed identity against current tenant membership and returns its persisted workspace. The verifier, issuer, audience, and tenant membership checks remain authoritative. `/auth/register` remains a compatible alias for signup.
- `AUTH_ADAPTER_MODULE` can still select a trusted adapter module instead of the built-in verifier.

The API verifies the JWT signature and never trusts organization IDs supplied by callers. The browser stores the signed session and sends it only to the same-origin API proxy.

## Routes

- `POST /auth/signup` — create an account, workspace, and OWNER membership; return a signed session.
- `POST /auth/register` — compatible alias for signup.
- `POST /auth/login` — verify a persisted password and workspace membership; return a signed session.
- `GET /auth/session` — validate the bearer token and return the user's persisted workspace and membership.
- `POST /analysis` — create or reuse an analysis run/job and enqueue it.
- `GET /analysis/:runId` — retrieve sanitized analysis status/progress.
- `POST /repositories/local-zip` — validate and persist a bounded local ZIP snapshot. This is the only repository-ingestion endpoint exposed by the MVP.
- `GET /repositories` and `GET /repositories/:repositoryId` — list and inspect repositories.
- `GET /repositories/:repositoryId/history` — analysis history.
- `GET /repositories/:repositoryId/findings` and `GET /findings/:findingId` — findings, current occurrence, evidence graph, risk assessments, and any validated advisory AI investigation for the selected occurrence/evidence.
- `GET /repositories/:repositoryId/health` — health snapshot history.
- `GET /repositories/:repositoryId/reports` — list persisted report summaries.

Report generation/download is not exposed as an API workflow. The API and worker `start` commands and database `migrate` command load the root `.env.local`. Optional AI investigation uses worker-only `GROQ_API_KEY` and `GROQ_MODEL`; deterministic analysis does not require them, and AI output is advisory only. The live analysis and account/ZIP onboarding paths are documented in [the backend completion checklist](../../docs/BACKEND_COMPLETION_CHECKLIST.md). Apply migrations through `0010` before using the AI investigation persistence against an existing database.
