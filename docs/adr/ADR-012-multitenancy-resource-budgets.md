# ADR-012 — Multi-Tenant Isolation and Resource Budgets

- **Status:** Accepted
- **Date:** 2026-10-07
- **Decision:** Use shared PostgreSQL with tenant identifiers and appropriate RLS, plus tenant-aware scheduling and budgets.

## Context
BugZero is multi-tenant and analysis workloads can be CPU, memory, storage, queue, and AI-cost intensive.

## Decision
Organizations own repositories and analysis state. Roles are OWNER, ADMIN, DEVELOPER, SECURITY_REVIEWER, and VIEWER. PostgreSQL tenant identifiers and row-level security are used where appropriate.

Credentials are stored behind a dedicated secret-management boundary with encryption, rotation, revocation, scoped permissions, and audit logging.

Queues enforce tenant-aware priorities, quotas, concurrency limits, analysis budgets, and AI cost budgets.

## Consequences
- Better isolation and predictable service behavior.
- Scheduling and quota logic become platform responsibilities.
- Secret handling cannot be delegated to ordinary application tables.
