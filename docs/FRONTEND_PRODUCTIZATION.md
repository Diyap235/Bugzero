# Frontend Productization

## Product experience

The root Next.js App Router application is the active frontend. `/` restores the full-screen BugZero landing page with an illustrative overview built from the centralized sample workspace. It does not wait for workspace requests. Visitors continue through `/login`, authenticate with the local demo account, and reach `/dashboard`; the dashboard uses the centralized sample workspace without making API requests.

If live workspace data is unavailable or empty, the UI remains usable with a clearly labeled sample workspace. The fallback is centralized in `src/domains/product/sample-data.ts`:

- Repository `bugzero-demo`, default branch `main`, languages TypeScript and Python.
- Overall health 82, security 88, quality 79, and source coverage 74%.
- Three sample findings, including a critical SQL injection with a complete request-to-query evidence path and a technical risk score of 87.
- Sample run and health history to populate the overview, analysis, and trend views.

Live data replaces the sample when available. Unknown health dimensions remain unknown rather than being shown as zero. The repository detail's Analyze action starts a real analysis for a live repository with an indexed commit; in sample mode it demonstrates the queued-to-completed stage progression without pretending to create a persisted run.

## Routes

| Route | Behavior |
|---|---|
| `/` | Full-screen product landing page with a sample repository overview. The code/editor visualization is illustrative sample content. |
| `/login` | Demo sign-in form. Valid credentials create a client-only demo token and a sessionStorage session. |
| `/dashboard` | Protected product overview using the centralized sample workspace only. |
| `/repositories` | Searchable repository list with branch, commit, health, and analysis status. A sample repository is available when the live list is empty or cannot be loaded. |
| `/repositories/[id]` | Repository health, findings, analysis status, and Analyze action. Sample mode supports a stage-by-stage analysis demonstration. |
| `/findings` | Filterable findings list using live findings or sample findings. |
| `/findings/[id]` | Finding detail with severity, confidence, lifecycle, source location, evidence graph, risk assessment, and unknown/incomplete evidence states. |
| `/health` | Health snapshots, dimensions, unknown states, coverage, and history. |
| `/history` | Analysis runs, status, stage, findings, risk, and health. |
| `/analysis/[id]` | Analysis status and progress. |
| `/reports` | Honest coming-soon state with a link to analysis history. |
| `/settings` | Honest unavailable state for account and workspace preferences. |

All workspace routes listed above are gated by the app-shell auth guard. The landing page and login page remain public.

## Demo authentication and session

`src/lib/auth/` isolates auth types, session storage helpers, demo credential validation, and the React auth context. The current provider is `DemoAuthProvider`; replace it with a real provider when a server-side auth service exists. The demo account is `demo@bugzero.dev` / `demo123`. Its opaque token is generated in the browser and expires after 24 hours. Only the token and minimal demo identity/session metadata are kept in `sessionStorage`; passwords are never persisted or placed in the token. The app shell gates workspace routes, the top bar clears the session on logout, and expired sessions are cleared and redirected to sign-in.

**Demo authentication only — replace with server-issued, server-verified authentication before production.** The browser-generated demo token is not a JWT, is not signed, and is not verified by the backend. It provides a protected-UI demo boundary only; it must never be treated as production authentication or sent to backend services.

## Data integration and limitations

`src/lib/api-client.ts` remains an internal data client for views that support persisted workspace records. Requests are bounded to five seconds; fallback-enabled views keep rendering the centralized sample while live data loads. The demo auth token is never sent to it. The dashboard and demo sign-in require no API, database, Redis, or external provider. Other route integrations support repository list/detail, history, findings, finding evidence/risk, health history, and analysis status; `src/hooks/useApiResource.ts` supplies their marked sample fallback.

The API and database work remain separate from the user-facing product language. The current backend does not expose repository installation/ingestion, report exports, account management, or preference persistence. The frontend does not simulate those actions. In particular, sample analysis progress is labeled as a demonstration and is not recorded as a real analysis run.

Source snippets are not included unless available from persisted data; current finding detail uses the recorded source location. Findings show the stored evidence authority, provenance, sufficiency, completeness, graph nodes/edges, risk dimensions, and explanations. No AI-generated remediation is presented.

## UI and mock-data cleanup

Seeded mock services and obsolete feature components were removed. Product fallback records are centralized in `src/domains/product/sample-data.ts`; pages consume this fixture rather than defining their own repository, finding, risk, evidence, or health examples. Shared product UI in `src/components/product/ui.tsx` provides headings, metrics, status labels, unknown values, and resource states. Navigation active states are route-specific.

The user-facing interface does not ask users to connect a service or expose service URLs, credentials, or connection status. Errors in fallback-enabled views preserve retry capability while keeping internal service details out of product copy.

## Validation

Run `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm build` from the repository root. Real account authentication is not implemented. The sample workspace and demo session work without the API or its infrastructure.
