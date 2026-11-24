# ADR-013 — Docker Compose v1 Deployment

- **Status:** Historical deployment proposal; queue/graph topology superseded by ADR-017
- **Date:** 2026-10-07
- **Decision:** Use Docker Compose for the first complete BugZero deployment.

## Context
The architecture needs multiple services locally and in early environments without Kubernetes operational overhead.

## Decision
The original v1 proposal used Next.js web, Fastify API, Python analysis workers, PostgreSQL, Redis, and MinIO/S3-compatible object storage. Redis is no longer required; PostgreSQL now provides durable queue and code graph storage. Object storage is outside this PostgreSQL-only queue/graph change.

Kubernetes is explicitly deferred until workload measurements and operational needs justify it.

## Consequences
- Fast local onboarding and reproducible environments.
- Horizontal scaling is possible but limited compared with a full orchestrator.
- Production evolution may require a later deployment ADR.
