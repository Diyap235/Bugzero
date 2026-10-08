# ADR-001 — Product Platform / Intelligence Boundary

- **Status:** Accepted
- **Date:** 2026-10-07
- **Decision:** TypeScript owns the product platform; Python owns code intelligence.

## Context
BugZero needs a stable SaaS/product layer and a language-analysis layer with different scaling and ecosystem needs.

## Decision
Use Next.js/React/TypeScript for the web product, Fastify/TypeScript for the API and product orchestration, and Python for parsing, Code IR construction, static/security analysis, evidence generation, and AI orchestration.

The boundary is contract-driven. TypeScript does not embed Python internals, and Python does not own product workflows, tenancy, authentication, or UI concerns.

## Consequences
- Clear ownership and independent worker scaling.
- Shared contracts must remain explicit.
- Cross-boundary calls add serialization and operational complexity.
- Architecture changes crossing the boundary require an ADR update.
