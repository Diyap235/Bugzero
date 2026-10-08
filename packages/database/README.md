# BugZero Database Package

This package contains the TypeScript PostgreSQL pool, transaction helper, and repository adapters. PostgreSQL is the canonical store; the SQL-first migration history is owned by [`db/migrations/`](../../db/migrations/).

Tenant-scoped queries require the transaction-local `app.organization_id` setting as well as organization-scoped predicates. The PostgreSQL pool wrapper propagates the organization context for scoped statements, and multi-statement repository operations set it on their explicit transaction clients. Live API integration tests verify that cross-tenant reads and writes are rejected by RLS.

Run `pnpm --filter @bugzero/database migrate` to apply migrations `0001` through `0009` in order and track their checksums. Live PostgreSQL verification covers tenant isolation and account/local-snapshot onboarding. Use a disposable development database for repeated end-to-end tests because analysis health snapshots and evidence records are immutable. See [the backend completion checklist](../../docs/BACKEND_COMPLETION_CHECKLIST.md).
