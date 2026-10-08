# BugZero Database Design

**Status:** Foundation  
**Authority:** This document describes the PostgreSQL persistence model defined by `db/migrations/0001_bugzero_foundation.sql`. `docs/SYSTEM_DESIGN.md` remains the technical source of truth; this document does not supersede it.

## 1. Persistence boundaries

PostgreSQL is the canonical transactional store for product metadata and analysis state. This follows SYSTEM_DESIGN sections 38–41 and ADR-010.

| Information | Canonical source |
| --- | --- |
| Source code | Git commit |
| Repository metadata | PostgreSQL |
| Code IR and relationships | Derived from source and rebuildable |
| Evidence | Immutable, revisioned analysis result |
| Findings | Finding system with immutable occurrences |
| Health | Derived snapshot |
| Search/index data | Rebuildable derived state |
| Cache and queue state | Redis; never authoritative |
| Large repository and analysis artifacts | Object storage |
| AI explanation | Derived enrichment |

The migration is SQL-first and uses PostgreSQL directly. No ORM or third-party migration framework is introduced. Migrations `0001` through `0007` are canonical and applied by the tracked `packages/database` runner. Clean-database execution and live constraint validation remain outstanding.

## 2. Entity relationships

```text
organizations ── members ── users
      │
      └── repositories ── repository_commits ── repository_files
                 │                 │
                 │                 ├── analysis_runs ── analysis_jobs
                 │                 ├── code_entities ── code_relationships
                 │                 ├── dependencies ── dependency_edges
                 │                 ├── findings ── finding_occurrences ── evidence
                 │                 │                                  ├── evidence_nodes
                 │                 │                                  └── evidence_edges
                 │                 ├── health_snapshots
                 │                 ├── reports
                 │                 └── ai_explanations
                 └── audit_logs
```

Every tenant-owned table has `organization_id`. Composite foreign keys include the tenant identifier so a row cannot reference a parent belonging to another organization. `users` are global identity records; organization membership and authorization are represented by tenant-scoped `members`.

## 3. Revision and finding identity

Repository commits are unique by organization, repository, and Git commit SHA. Repository files, Code IR, relationships, analysis runs, and dependency snapshots reference a specific commit.

A `findings` row represents an underlying issue. Its identity uses the rule and a versioned semantic `identity_fingerprint`; it is explicitly not keyed by file path or line number. `finding_occurrences` record immutable observations at a particular commit and analysis run, including historical location, fingerprint, assessment, and observation state.

`observation` is separate from finding `lifecycle`. `NOT_DETECTED` does not mean `RESOLVED`. A resolved finding must reference evidence whose occurrence is `NOT_DETECTED`, whose analysis run completed, and whose evidence is authoritative, complete, and sufficient. The migration enforces this resolution precondition.

## 4. Evidence and enrichment

Each `evidence` row is an immutable version tied to an organization, repository, commit, analysis run, finding, and occurrence. Evidence records its `origin`, `authority` (`AUTHORITATIVE` or `INVESTIGATIVE`), sufficiency, completeness, analyzer versions, graph paths, diagnostics, and an idempotency fingerprint. Migration `0005_versioned_evidence_graph.sql` adds these explicit snapshot identity/completeness fields and evidence node source ranges; the database uniqueness key prevents duplicate snapshots per occurrence and identity. Database checks require AI- and heuristic-origin evidence to remain investigative; authoritative evidence must come from deterministic analysis or human validation. Incomplete evidence cannot claim `SUFFICIENT`.

Evidence nodes and edges belong to a specific evidence version. The edge foreign keys prevent links to nodes from another evidence graph. Historical evidence, nodes, edges, and occurrences reject updates and deletes; improved analysis creates new records. Evidence paths are ordered JSON on the snapshot, while nodes/edges remain separately queryable. The worker writes a snapshot and its graph atomically using the evidence repository.

AI explanation rows are derived and immutable. They do not carry authority to promote investigative evidence into authoritative evidence. AI output remains associated with its source occurrence and, when applicable, an evidence version.

## 5. Analysis, IR, dependencies, health, and reports

- `analysis_profiles` version the configuration used by a run.
- `analysis_runs` bind profile, scope, repository, and commit.
- `analysis_jobs` hold retryable/idempotent asynchronous stage work.
- `code_entities` and `code_relationships` are commit-scoped derived IR; they can be rebuilt.
- `dependencies` and `dependency_edges` are commit-scoped dependency snapshots.
- `health_snapshots` preserve derived health at a commit.
- `reports` reference the analysis run they represent; artifact bytes may live in object storage.
- `audit_logs` preserve organization-scoped actor and state-change records.

## 6. Repository intelligence and query performance

Repository intelligence is derived state built from the persisted Code IR and dependency snapshots. It is intentionally not authoritative over the underlying Git source tree. Intelligence is scoped to `organization_id`, `repository_id`, and `commit_id`, and every query must apply the same commit-scoped filters so a later commit cannot leak earlier relationships.

The repository intelligence queries use the existing Postgres repository abstractions and are optimized for the patterns below:

```text
repository + commit + entity_id
repository + commit + qualified_name
repository + commit + file_path
repository + commit + entity_type
repository + commit + source_entity_id
repository + commit + target_entity_id
repository + commit + relation
repository + commit + package_name
```

Additional forward indexes are deliberately added in `db/migrations/0002_repository_intelligence_indexes.sql` to avoid full scans when building call graphs, import graphs, dependency chains, and impact traversals. They are additive and do not rewrite historical migration state. Migrations `0003`–`0007` add occurrence, relationship, evidence, risk, and health idempotency/versioning constraints.

## 7. Tenant isolation and application use

Row Level Security is enabled and forced for tenant-owned tables. Each connection transaction must set the authorized tenant before querying:

```sql
BEGIN;
SET LOCAL app.organization_id = '00000000-0000-0000-0000-000000000000';
-- tenant-scoped statements
COMMIT;
```

The application must derive this value from authenticated membership, never from an untrusted request field alone. Queries must continue to include organization scope and perform authorization checks; RLS is a database backstop, not a replacement for application authorization. The current repository adapters do not yet establish `app.organization_id`, so live tenant-owned operations are not ready for deployment. The shared `users` identity table is intentionally not tenant-scoped; access to it must be limited to authenticated identity operations.

The application database role must not own the tables or have `BYPASSRLS`. Migration/administration credentials must be kept separate from runtime credentials. A missing tenant setting yields no matching tenant rows.

## 7. Migration ownership

`db/migrations/` is the canonical SQL migration location. Apply `0001` through `0007` in numeric order with `pnpm --filter @bugzero/database migrate`; later migrations extend the existing evidence/risk/health persistence model and do not rewrite older migration history. `packages/database/` is the TypeScript package for persistence adapters and database-facing types; it must not contain a second nested database directory or duplicate migration history. No database queries or persistence behavior belong in shared contracts or the Python analysis engine.
