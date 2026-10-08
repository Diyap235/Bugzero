# BugZero API workspace

The Fastify API implements authenticated analysis dispatch/status and tenant-scoped product read routes. The analysis endpoint validates a request, checks organization membership and role, resolves an indexed repository commit and analysis profile, creates or reuses run/job work in PostgreSQL, and enqueues the job through BullMQ/Redis.

## Runtime requirements

- `DATABASE_URL` for PostgreSQL.
- `REDIS_URL` shared with the worker.
- Local development uses the built-in `jose` EdDSA JWT verifier. Initialize a development keypair and local environment with `pnpm --filter @bugzero/api dev-auth:setup`, then start the API with `pnpm --filter @bugzero/api dev`.
- The setup command creates a local Ed25519 keypair and writes only the public key to the ignored root `.env.local`, using `AUTH_PUBLIC_KEY=<PEM with escaped newlines>`, `AUTH_ISSUER=bugzero-auth`, and `AUTH_AUDIENCE=bugzero-api`. The API verifies JWT signatures with `AUTH_PUBLIC_KEY`. Keep the development private key outside source control at `~/.bugzero/dev-auth/ed25519-private.pem`; never copy it into the repository or configure it on the API.
- To generate a short-lived development JWT, run `pnpm --filter @bugzero/api dev-auth:token -- --sub <user-uuid> --org <organization-uuid>`. Use existing development user and organization IDs. The signed token contains `sub` (user UUID), `org` (organization UUID), `iss`, `aud`, `iat`, and `exp`; membership and role are checked by the API and are not caller-supplied token privileges. The default lifetime is 15 minutes (up to 24 hours can be requested with `--expires-in-seconds`).
- `AUTH_ADAPTER_MODULE` can still select a trusted adapter module instead of the built-in verifier.

This local-development issuer is not a production identity provider. No external or production issuer, signer, or identity provider is implemented here. The client-side demo token is not valid API authentication. The API verifies the JWT signature and must not trust organization IDs supplied by callers.

## Routes

- `POST /analysis` — create or reuse an analysis run/job and enqueue it.
- `GET /analysis/:runId` — retrieve sanitized analysis status/progress.
- `GET /repositories` and `GET /repositories/:repositoryId` — list and inspect repositories.
- `GET /repositories/:repositoryId/history` — analysis history.
- `GET /repositories/:repositoryId/findings` and `GET /findings/:findingId` — findings, current occurrence, evidence graph, and risk assessments.
- `GET /repositories/:repositoryId/health` — health snapshot history.
- `GET /repositories/:repositoryId/reports` — list persisted report summaries.

Repository registration/ingestion and report generation/download are not exposed as API workflows. Live PostgreSQL, Redis, and API-to-worker behavior remain unverified; see [the backend completion checklist](../../docs/BACKEND_COMPLETION_CHECKLIST.md).
