# ADR-007 — Evidence-Scoped AI Enrichment

- **Status:** Accepted
- **Date:** 2026-10-07
- **Decision:** AI is an asynchronous, bounded enrichment and investigation layer, never the authority for deterministic technical truth.

## Context
AI is useful for explanations, remediation suggestions, classification, false-positive assistance, and architecture reasoning, but unconstrained repository scanning is unsafe, expensive, and difficult to reproduce.

## Decision
AI receives an Evidence Package containing the finding, relevant evidence graph, bounded IR context, source snippets, dependencies, and relevant history. It does not receive the entire repository by default.

AI may explain, investigate, classify, propose remediation, or form hypotheses. AI-generated evidence remains investigative until validated by an appropriate deterministic analyzer. AI failure must not block deterministic analysis.

Risk and technical severity remain deterministic. Human disposition remains separate from machine conclusions.

## Consequences
- Lower token cost and better grounding.
- AI quality depends on evidence quality.
- Additional asynchronous state is required for AI enrichment.
