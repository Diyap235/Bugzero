# ADR-010 — PostgreSQL Canonical Metadata with Derived Indexes and Object Storage

- **Status:** Accepted
- **Date:** 2026-10-07
- **Decision:** PostgreSQL is the canonical product database; object storage holds large artifacts; specialized indexes are derived.

## Context
BugZero needs transactional product state, large analysis artifacts, and fast relationship/search operations without introducing a mandatory graph database.

## Decision
PostgreSQL stores repositories, revisions, jobs, findings, evidence metadata, dependencies, health snapshots, AI explanations, and audit records. Object storage holds repository archives and large artifacts. Code/relationship/search indexes are derived and rebuildable. Redis is cache/queue state and never authoritative.

No graph database is mandatory in v1.

## Consequences
- Strong transactional consistency.
- Fewer infrastructure dependencies.
- Specialized traversal/search indexes must be designed and benchmarked.
