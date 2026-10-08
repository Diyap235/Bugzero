# ADR-005 — Versioned Evidence Graph with Two-Tier Authority

- **Status:** Accepted
- **Date:** 2026-10-07
- **Decision:** Evidence is a first-class, immutable, versioned technical proof object; authoritative and investigative evidence are distinct.

## Context
Security findings need explainable proof, while real program relationships may branch, converge, or remain unresolved.

## Decision
Represent evidence internally as an Evidence Graph composed of facts, paths, snapshots, provenance, and completeness. Human-facing source snippets and paths are projections of that graph.

Authoritative Evidence comes from deterministic or validated analysis. Investigative Evidence can come from AI or heuristics but remains UNVERIFIED and cannot promote itself.

Evidence is tied to a repository revision, occurrence, analyzer/version, and completeness state. Historical evidence is immutable; new analysis produces new evidence versions.

When an unresolved relationship could materially change the conclusion, targeted analysis expands the scope. If uncertainty remains, evidence stays explicitly incomplete and cannot support a fully proven conclusion.

Retention is tiered: finding-associated, critical security, audit/report, and historical evidence are persisted; low-value intermediate artifacts may be cached or regenerated.

## Consequences
- Strong auditability and explainability.
- More storage for high-value evidence.
- Evidence sufficiency becomes a first-class analysis decision.
