# ADR-015 — Separate Machine Assessment from Human Disposition

- **Status:** Accepted
- **Date:** 2026-10-07
- **Decision:** Machine technical conclusions, human organizational decisions, and operational lifecycle are separate concepts.

## Context
Technical severity should not be overwritten by business priority or accepted risk. Human decisions must remain auditable without mutating historical machine evidence.

## Decision
Machine Assessment contains severity, confidence, evidence strength, exploitability, reachability, and technical risk. Human Disposition contains business priority, accepted risk, exceptions, and disposition. Lifecycle tracks OPEN, CONFIRMED, IN_PROGRESS, RESOLVED, DISMISSED, and REOPENED.

Human actions record actor, timestamp, previous state, new state, and reason. Human overrides do not erase machine analysis.

## Consequences
- Strong auditability.
- Slightly richer data model.
- Clearer separation between technical truth and business decisions.
