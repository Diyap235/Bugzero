# Frontend Productization

## Product experience

The active Next.js App Router application is the repository-root `src/app`
tree. New users create an account and workspace at `/signup`, receive an
Ed25519-signed session, and enter the real `/repositories` workspace. Returning
users authenticate against their persisted account at `/login`.

Authenticated product views use tenant-scoped API data only. Empty and failed
API results remain empty/error states; the UI never substitutes sample
repositories, findings, health, or analysis progress. The public `/` landing
page remains a separate illustrative product page and is not used as workspace
data.

## Real onboarding and codebase ingestion

`POST /auth/signup` transactionally persists the user, scrypt password hash,
organization/workspace, and OWNER membership. `POST /auth/register` remains a
compatible alias. `POST /auth/login` verifies the
password and persisted membership, then signs a short-lived EdDSA JWT using the
existing verifier architecture. The browser stores the session in
`sessionStorage`, which survives page refreshes, and sends the JWT to the
same-origin API path. On refresh, `GET /auth/session` confirms the token still
has current tenant membership. No API URLs, keys, or backend settings are
exposed in product UI.

Repository ingestion is ZIP-only. `/repositories` validates and uploads a ZIP
using `POST /repositories/local-zip`; the API enforces 10 MiB compressed, 20
MiB expanded, 2,000 entries, and 1 MiB per file. Unsafe/conflicting paths,
symlinks, encrypted entries, corrupt data, binary source files, and invalid
UTF-8 source are rejected. Supported JavaScript, TypeScript, and Python
sources are persisted with SHA-256 hashes in PostgreSQL alongside a `LOCAL`
repository and deterministic Git commit snapshot. The worker validates stored
content hashes before parsing.

After persistence, the frontend sends the repository ID and persisted commit
SHA to the normal `POST /analysis` endpoint. Status is polled from
`GET /analysis/:runId`; no ZIP-specific analyzer or synthetic result path is
used. Queue/worker failures remain persisted as failed analysis states and are
shown to the user.

## Routes

| Route | Behavior |
|---|---|
| `/` | Public illustrative product page; its preview is not workspace data. |
| `/signup` | Create a persisted account and workspace; establish the signed session. |
| `/register` | Compatibility redirect to `/signup`. |
| `/login` | Authenticate a persisted account and restore its workspace session. |
| `/dashboard` | Tenant-scoped repository, finding, and health summaries. |
| `/repositories` | Persisted repository list, secure ZIP upload, first-analysis dispatch, and explicit empty/error states. |
| `/repositories/[id]` | Persisted repository details, analysis polling, findings, health, and re-analysis. |
| `/findings` | Persisted tenant-scoped findings. |
| `/findings/[id]` | Finding detail, occurrence, evidence graph, and risk assessments. |
| `/health` | Persisted health snapshots and history. |
| `/history` | Persisted analysis runs and job state. |
| `/analysis/[id]` | Persisted analysis status and progress. |
| `/reports` | Persisted report summaries; report generation/download remains unsupported. |
| `/settings` | Honest unavailable state for account/workspace preferences. |

Workspace routes are gated by the application auth state. API membership and
PostgreSQL RLS remain the authorization boundaries; frontend route guards are
not a substitute for server-side enforcement.

## Validation

Run `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm build` from the
repository root.
