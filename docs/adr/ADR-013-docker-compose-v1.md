# ADR-013 — Docker Compose v1 Deployment

- **Status:** Accepted
- **Date:** 2026-10-07
- **Decision:** Use Docker Compose for the first complete BugZero deployment.

## Context
The architecture needs multiple services locally and in early environments without Kubernetes operational overhead.

## Decision
The v1 deployment consists of Next.js web, Fastify API, Python analysis workers, PostgreSQL, Redis, and MinIO/S3-compatible object storage. Service boundaries remain compatible with later independent deployment.

Kubernetes is explicitly deferred until workload measurements and operational needs justify it.

## Consequences
- Fast local onboarding and reproducible environments.
- Horizontal scaling is possible but limited compared with a full orchestrator.
- Production evolution may require a later deployment ADR.
