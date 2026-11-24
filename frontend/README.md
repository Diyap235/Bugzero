# BugZero frontend

The Next.js application and frontend tests live in this package. Run its
development server with `pnpm --dir frontend dev`; root scripts delegate to the
frontend package while continuing to expose monorepo-wide checks.

The Next.js scripts load the ignored repository-root `.env.local` when present.
The API base URL can be configured through the server-only `BUGZERO_API_URL`;
the local default is `http://127.0.0.1:3001`.

See [the frontend/backend integration map](../docs/FRONTEND_BACKEND_INTEGRATION.md)
for API routes and authentication behavior.
