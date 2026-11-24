# Environment and deployment

BugZero uses Neon PostgreSQL for application data and its durable job queue.
No local PostgreSQL service, Redis, or Neo4j instance is required. Runtime
commands accept platform-injected variables and load the ignored root
`.env.local` only when it exists. Node.js 22.9 or newer is required for
`--env-file-if-exists`.

## Local development

Link the Neon project to its development branch, not production:

```powershell
neon checkout development --project-id noisy-shape-13318805 --no-env-pull
neon env pull --project-id noisy-shape-13318805 --branch development --file .env.local --env DATABASE_URL --env DATABASE_URL_UNPOOLED
```

The resulting `.env.local` is Git-ignored. Keep credentials out of terminals,
logs, screenshots, and source control. Configure `DATABASE_QUEUE_URL`
separately only after creating the dedicated `bugzero_queue_worker` login on
that branch. Configure `DATABASE_QUEUE_LOCK_URL` from the direct, unpooled
connection details for the same Neon project, branch, and database, using the
same queue-worker role and credentials. Do not use a privileged owner or
`BYPASSRLS` role for queue claims. `DATABASE_QUEUE_URL` remains pooled for
normal queue queries; the dedicated direct lock connection is required because
the session-level advisory lock must be acquired and released on the same
PostgreSQL session. Worker startup checks the actual connected role's
`BYPASSRLS` attribute with a read-only query. The worker requires all three of
`DATABASE_URL`, `DATABASE_QUEUE_URL`, and `DATABASE_QUEUE_LOCK_URL`.

Apply ordered migrations only after verifying the linked Neon branch and
confirming that the queue role exists before migration 0014:

```powershell
pnpm --filter @bugzero/database migrate
```

The command uses `DATABASE_URL_UNPOOLED`; the API and worker use the pooled
`DATABASE_URL` for normal queries. Start the API with
`pnpm --filter @bugzero/api dev` and the Next.js frontend with `pnpm dev`.
In development, the API starts the local worker automatically; do not start a
second standalone worker. Production deployments run a standalone worker with
`pnpm --filter @bugzero/workers start`.

## Vercel frontend

Deploy the repository-root Next.js application. Set:

| Variable | Purpose |
|---|---|
| `BUGZERO_API_URL` | Public Render API origin used by the server-side rewrite |

Do not expose database or signing-key variables to the frontend or prefix them
with `NEXT_PUBLIC_`.

## Render API web service

Use the repository root as the service root. Build with the repository's
workspace install/build workflow and start with:

```text
pnpm --filter @bugzero/api start
```

Set `DATABASE_URL` to the intended Neon branch's pooled connection and set the
authentication variables required by the configured API adapter:
`AUTH_PUBLIC_KEY`, `AUTH_PRIVATE_KEY`, `AUTH_ISSUER`, `AUTH_AUDIENCE`, and
`AUTH_ACCESS_TOKEN_SECONDS`. Supply private signing material through Render's
secret environment configuration only. Render supplies `PORT`.

## Render background worker

Start with:

```text
pnpm --filter @bugzero/workers start
```

Set `DATABASE_URL` to the same intended Neon branch used by the API and
`DATABASE_QUEUE_URL` to a pooled connection for the dedicated,
non-`BYPASSRLS` `bugzero_queue_worker` role. Set `DATABASE_QUEUE_LOCK_URL` to
that same role and database's direct, unpooled endpoint. The worker validates
that the direct endpoint, database, and role match the pooled queue URL, then
checks the effective role's `BYPASSRLS` attribute read-only. Do not point the
lock URL at a pooler: session-level locks must remain on one PostgreSQL session
for their entire lifetime. Migration 0014 must be applied after the role exists
so its restricted table grants are installed. Never substitute the database
owner URL. `NVIDIA_API_KEY` and `NVIDIA_MODEL` are optional worker-only
advisory review settings. Keep these on the worker/backend environment and do
not expose them to the frontend.

## Migration execution

Run migrations as a reviewed, explicit deployment step (not automatically on
every API or worker start). Set `DATABASE_URL_UNPOOLED` to the direct,
unpooled URL for the exact Neon branch being migrated, then run:

```text
pnpm --filter @bugzero/database migrate
```

The runner validates the URL as a Neon PostgreSQL URL, serializes concurrent
runs with an advisory lock, and records checksummed migration history. Validate
new migrations on a disposable Neon branch first. Never point this command at
production until the reviewed migration has passed on the validation branch.

## Required variable summary

| Service/operation | Required variables |
|---|---|
| Local API | `DATABASE_URL`, `AUTH_PUBLIC_KEY`, `AUTH_PRIVATE_KEY`, `AUTH_ISSUER`, `AUTH_AUDIENCE`, `AUTH_ACCESS_TOKEN_SECONDS` |
| Local worker | `DATABASE_URL`, `DATABASE_QUEUE_URL`, `DATABASE_QUEUE_LOCK_URL` |
| Vercel frontend | `BUGZERO_API_URL` |
| Render API | `DATABASE_URL`, configured `AUTH_*` variables |
| Render worker | `DATABASE_URL`, `DATABASE_QUEUE_URL`, `DATABASE_QUEUE_LOCK_URL` |
| Migration execution | `DATABASE_URL_UNPOOLED` |
