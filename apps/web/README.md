# BugZero web workspace

The active Next.js application is currently rooted at `src/app` and uses the
repository-root `package.json` scripts. This package directory contains its own
placeholder manifest/configuration and the web-focused tests; it is not the
application source tree invoked by the root scripts.

## Current role

- focused frontend tests
- package-local Next.js metadata retained for future workspace cleanup

## Integration map

See [the frontend/backend integration map](../../docs/FRONTEND_BACKEND_INTEGRATION.md)
for the active application paths, API mappings, authentication configuration,
and unsupported report operations.
