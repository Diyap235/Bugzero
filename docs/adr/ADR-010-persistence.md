# ADR-010 — PostgreSQL Canonical Metadata with Derived Indexes and Object Storage

- **Status:** Accepted; persistence and graph boundaries superseded by ADR-017
- **Date:** 2026-10-07
- **Decision:** PostgreSQL is the canonical product database; object storage holds large artifacts; specialized indexes are derived.

## Context
BugZero needs transactional product state and a repository-scoped graph representation for code relationships.

## Decision
This ADR originally assigned queue state to Redis and the active code graph to Neo4j. Those boundaries are historical and are superseded by ADR-017, which places queue state and run-scoped code graph data in PostgreSQL. PostgreSQL remains canonical for product and analysis records; object storage holds large artifacts.

## Consequences
- Strong transactional consistency.
- PostgreSQL remains authoritative for product and analysis results.
- Historical PostgreSQL Code IR rows and migrations remain preserved; current graph writes use run-scoped PostgreSQL tables.
