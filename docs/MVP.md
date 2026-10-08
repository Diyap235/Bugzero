# BugZero MVP scope

## Status

The repository implements a bounded deterministic analysis MVP, but is not yet a runnable end-to-end product deployment. The worker pipeline, analysis API, persistence model, and evidence/risk/health calculations exist; trusted authentication, repository onboarding, tenant RLS access, and live infrastructure integration remain unfinished.

## MVP foundation

The implemented MVP scope includes:

- repository/commit ingestion service and commit-scoped snapshots
- PostgreSQL schema, repository adapters, and seven ordered migrations
- shared typed request/analysis/report contracts
- semantic Code IR, Repository Intelligence, and bounded impact analysis
- deterministic Structural/Quality analysis and partial SQL Injection rule
- finding/occurrence identity and replay-safe persistence
- immutable evidence graph, deterministic risk, and repository health
- API analysis dispatch/status and product read routes

## Outside the MVP scope

The design defers broad security/dependency analysis, AI enrichment, autonomous fixes, and production-scale performance claims. Live PostgreSQL/Redis/Docker deployment, verified authentication, API repository onboarding, and real external end-to-end execution are not yet complete.

## Summary

The MVP has a tested in-memory analysis path and typed API boundaries. It is not yet production-ready or verified as a live API-to-worker-to-PostgreSQL/Redis product flow.
