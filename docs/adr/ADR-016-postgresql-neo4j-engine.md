# ADR-016 — PostgreSQL Product State and Neo4j Code Graph (Superseded)

- **Status:** Superseded by ADR-017
- **Date:** 2026-10-10
- **Decision:** Keep PostgreSQL as the product and analysis source of truth; use Neo4j for repository-scoped code graphs.

## Context

The clean-slate engine target requires code relationships, impact traversal, and source/data-flow relations to be represented as a graph while preserving tenant isolation and the immutable PostgreSQL finding/risk/health history. The prior system design explicitly made a graph database optional; this decision supersedes that boundary.

## Decision

- PostgreSQL remains authoritative for users, organizations, memberships, repositories, commits, analysis runs/jobs, findings/occurrences, evidence metadata, risk assessments, health snapshots, and history.
- Neo4j stores rebuildable files, symbols, functions, dependencies, calls, imports, and source/data-flow relationships.
- Every Neo4j record and query is scoped by organization, repository, commit, and analysis run.
- Stable scoped IDs, uniqueness constraints, `MERGE`, and managed transaction retries make graph writes idempotent. Graph failure is an analysis failure/partial state, never a successful fallback.
- Existing PostgreSQL Code IR tables and migration history remain untouched for historical preservation; the worker no longer writes to them.
- TypeScript remains responsible for product orchestration and persistence integration. A separate Python parser is not introduced unless an evaluated parser requirement justifies a Python runtime.

## Consequences

- Worker deployments require configured Neo4j connectivity in addition to PostgreSQL and Redis.
- Findings, risk, and health remain queryable through authenticated PostgreSQL-backed APIs; the frontend never accesses Neo4j directly.
- Neo4j live integration, tenant isolation, retry behavior, graph traversal, and historical-data acceptance must be validated against an explicitly configured service before this architecture is considered fully accepted operationally.
