# Scaling and repository size strategy

## Status

BugZero defines a scaling strategy around progressive analysis and bounded work, but it does not yet claim a production-scale benchmark for very large repositories.

## Scaling approach

The architecture intentionally avoids a full-analysis-everything model. It emphasizes:

- commit-scoped analysis
- change-focused and impacted-code analysis
- progressive repository analysis
- PostgreSQL indexes for repository intelligence queries
- Redis/BullMQ for asynchronous job execution
- object storage for large artifacts

This is the core of the scaling design in `docs/SYSTEM_DESIGN.md` and the ADRs.

## Constraints

The repository does not claim verified support for 1M+ LOC without run-time benchmarking. Instead, it defines a path for incremental and progressive analysis to keep resource use bounded and avoid invalid conclusions.

## Current state

The scaling framework is documented and partially reflected in the schema and repository query design. The actual production-scale execution model remains a future implementation layer.
