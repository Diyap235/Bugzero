# BugZero Database Package

This package contains the TypeScript PostgreSQL pool, transaction helper, and repository adapters. PostgreSQL is the canonical store; the SQL-first migration history is owned by [`db/migrations/`](../../db/migrations/).

All tenant-owned schema tables use row-level security and require the transaction-local `app.organization_id` setting in addition to organization-scoped query predicates. The current adapters do not yet establish that setting, so live tenant-scoped access is incomplete and must not be considered production-ready.

Run `pnpm --filter @bugzero/database migrate` to apply migrations `0001` through `0007` in order and track their checksums. The runner and migration loading are unit tested, but no live PostgreSQL integration test suite or clean-database execution has been completed. Use a disposable development database until RLS context wiring and live validation are finished. See [the backend completion checklist](../../docs/BACKEND_COMPLETION_CHECKLIST.md).
