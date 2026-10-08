# ADR-002 — Modular Monolith + Scalable Workers

- **Status:** Accepted
- **Date:** 2026-10-07
- **Decision:** Use a modular monolith for product services with independently scalable asynchronous workers.

## Context
BugZero needs asynchronous analysis and future scale, but premature microservices would add operational complexity without proven need.

## Decision
Keep auth, organizations, repositories, findings, reviews, health, reports, and webhooks inside one Fastify product application. Run analysis, parser, dependency, security, and AI workloads in worker processes with Redis + BullMQ.

Workers communicate through explicit job contracts and persistent state, not direct coupling to product modules.

## Consequences
- Simple deployment and local development.
- Workers can scale independently.
- Module boundaries must be enforced inside the monolith.
- Kafka, Kubernetes, and many microservices are deferred until measured requirements justify them.
