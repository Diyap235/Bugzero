# Frontend/backend integration

The active Next.js application is the repository-root `src/app` tree. `apps/web`
currently contains only a placeholder README, package metadata, and frontend
tests; it is not the source tree used by the root `pnpm dev`, `pnpm build`, or
`pnpm lint` scripts.

## Authenticated data and endpoint mapping

| Current view/data | Real endpoint | Response shape used by the UI | UI consumer |
| --- | --- | --- | --- |
| Account/workspace onboarding | `POST /auth/signup`, `POST /auth/login`, `GET /auth/session` | Persisted account/workspace membership and signed Ed25519 JWT; membership is revalidated by session validation | `/signup`, `/login` |
| Repository list/detail | `GET /repositories`, then `GET /repositories/:repositoryId` | Persisted repositories, latest commit/run/job, latest health, finding counts | `/repositories`, `/repositories/:id`, `/dashboard` |
| Local codebase onboarding | `POST /repositories/local-zip`, then `POST /analysis` | Local repository, persisted snapshot/source files, queued analysis | ZIP upload form on `/repositories` |
| Repository analysis history | `GET /repositories/:repositoryId/history` | `history[]` containing run, job, finding count, total technical risk, and health score | `/history` |
| Finding sample rows | `GET /repositories/:repositoryId/findings` for each repository | `findings[]` containing finding and current occurrence | `/findings`, `/dashboard` |
| Finding detail/evidence/risk samples | `GET /findings/:findingId` | Finding, selected occurrence, nullable persisted evidence graph, and risk assessments | `/findings/:id` |
| Health history sample | `GET /repositories/:repositoryId/health` | `history[]` containing persisted snapshot and nullable commit SHA | `/health`, `/dashboard` |
| Report placeholder | `GET /repositories/:repositoryId/reports` | Shared `ReportListResponse` with persisted report summaries | `/reports` |
| Analysis status/progress | `POST /analysis`, then poll `GET /analysis/:runId` | Persisted job/run state and reported progress metrics | Repository detail and `/analysis/:id` |

The authenticated workspace uses persisted API data only. API failures do not
fall back to preview or sample content.

Local ZIP imports are authenticated and limited to 10 MiB compressed, 2,000
entries, and 20 MiB expanded, with a 1 MiB individual-file ceiling. Unsafe
paths, symlinks, encrypted entries, malformed/corrupted data, conflicting
paths, and invalid UTF-8 source files are rejected. JavaScript, TypeScript, and
Python source content is stored with its file metadata in PostgreSQL in the same
transaction as its local repository and revision. The revision SHA is generated
reproducibly by Git from the imported snapshot. The worker verifies the stored
content hashes before parsing and analyzing it.

## Authentication and API transport

The frontend sends API traffic to the same-origin `/api/bugzero` path. The root
Next.js rewrite forwards it to the server-only `BUGZERO_API_URL` setting (local
default `http://localhost:3001`); no API address or backend configuration is
shown in the product UI. Authenticated requests add the verified session JWT as
a bearer token. A 401 expires the session and returns the user to sign-in.

`POST /auth/signup` creates the user, scrypt password hash,
organization/workspace, and OWNER membership in one PostgreSQL transaction.
`POST /auth/register` remains a compatible alias. `POST /auth/login`
authenticates the persisted account and resolves its workspace from the
persisted default organization under tenant RLS. Both issue JWTs that use the
existing Ed25519 verifier architecture. Run
`pnpm --filter @bugzero/api dev-auth:setup` locally; production must provide
the matching `AUTH_PRIVATE_KEY` using a secret manager.
`GET /auth/session` validates the bearer token against current membership and
returns the persisted workspace context.

ZIP upload is the only repository-ingestion method exposed by the MVP. A
successful upload is immediately submitted to the existing analysis API and
BullMQ/Redis worker pipeline; no ZIP-specific analyzer or synthetic finding
path exists.

## Honest unsupported states

The API currently lists persisted report summaries only. Report creation and
download are not supported, so the Reports view does not offer fabricated
exports or download actions. Unknown or missing health metrics remain unknown;
they are not replaced with zero. API failures never fall back to preview data.
