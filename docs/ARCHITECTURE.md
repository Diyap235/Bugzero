# BugZero architecture summary

## Status

The deterministic Structural/Quality analysis worker is implemented. API-to-queue request handling is implemented behind a required trusted-authentication resolver; this repository does not yet provide the production identity/token verifier that supplies that resolver. PostgreSQL, Redis, API, and worker runtime deployment is not validated here.

## Runtime flow

```text
Client
  -> Fastify API (authenticated principal + organization membership)
  -> indexed repository + exact commit + analysis profile
  -> PostgreSQL transaction: analysis_run + analysis_job
  -> Redis / BullMQ: { organizationId, jobId }
  -> worker consumer
  -> parser / Code IR persistence
  -> Repository Intelligence / impact scope
  -> Structural/Quality analyzer
  -> Security analyzer (SQL_INJECTION)
  -> FindingRepository / FindingOccurrence
  -> immutable evidence snapshot / nodes / edges / paths
  -> deterministic Risk Engine v1 assessment
  -> immutable Risk Assessment / current-risk projection
  -> Repository Health aggregation / immutable revision snapshot
  -> analysis run/job status and coverage
```

The API enqueues only small identifiers and never reads or executes repository source. The worker reads the exact persisted Git commit. PostgreSQL remains canonical; queue state is transport state. The single queue is `bugzero-analysis-jobs`; API and worker use the same required `REDIS_URL` configuration.

## Component status

| Capability | Status |
|---|---|
| Repository ingestion and commit snapshots | IMPLEMENTED |
| API analysis create/status routes | IMPLEMENTED behind trusted authentication adapter |
| API-side trusted identity/token provider | PARTIAL / NOT PRESENT in this repository |
| Analysis-run/job transaction and active-work deduplication | IMPLEMENTED |
| BullMQ producer/worker consumer contract | IMPLEMENTED |
| Semantic Code IR, Repository Intelligence, impact analysis | IMPLEMENTED with documented parser limits |
| Structural/Quality Analyzer v1 and finding persistence | IMPLEMENTED |
| Deterministic finding evidence graph | IMPLEMENTED (bounded; see [EVIDENCE.md](EVIDENCE.md)) |
| Deterministic Risk Engine v1 | IMPLEMENTED (versioned, evidence-aware, bounded score; see [RISK.md](RISK.md)) |
| Repository Health v1 | IMPLEMENTED (deterministic Security/Quality/Maintainability aggregation; Dependency/Reliability UNKNOWN; see [HEALTH.md](HEALTH.md)) |
| Live PostgreSQL migration and API-to-worker deployment | NOT VERIFIED |
| SQL injection security rule v1 | IMPLEMENTED (partial language/data-flow coverage; see [SECURITY.md](SECURITY.md)) |
| Other Security/Taint families, dependency CVE analysis, AI | DEFERRED |

See [API.md](API.md), [ANALYZERS.md](ANALYZERS.md), [CODE_IR.md](CODE_IR.md), [FINDINGS.md](FINDINGS.md), [HEALTH.md](HEALTH.md), and [OBSERVABILITY.md](OBSERVABILITY.md) for exact boundaries.
