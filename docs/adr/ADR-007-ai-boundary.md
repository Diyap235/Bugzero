# ADR-007 — Evidence-Scoped AI Enrichment

- **Status:** Accepted
- **Date:** 2026-10-07
- **Decision:** AI is an asynchronous, bounded enrichment and investigation layer, never the authority for deterministic technical truth.

## Context
AI can help explain a persisted finding, but unconstrained repository scanning is unsafe, expensive, and difficult to reproduce.

## Decision
The optional worker-side Groq investigator runs only after deterministic analysis and health assessment. For each persisted finding with a matching occurrence and evidence snapshot, it receives finding metadata, bounded evidence graph elements and paths, and short source snippets near recorded evidence locations. It does not receive the whole repository, dependency inventory, or analysis history.

The response is strict-schema validated and stored as an advisory AI investigation associated with the finding occurrence and evidence snapshot. It is not a finding, evidence node, confirmation, disposition, or risk input. If the deterministic run or evidence is incomplete, the returned reasoning status is forced to `INSUFFICIENT_EVIDENCE`. Missing configuration, provider errors, malformed output, and timeouts are recorded as safe statuses and must not change deterministic analysis status.

Groq is optional and configured only in the worker environment with `GROQ_API_KEY` and `GROQ_MODEL`. Context, output tokens, source snippets, evidence graph elements, request timeout, and retries are bounded. Selected credential-like source assignments, bearer tokens, and private-key blocks are redacted, and sensitive paths are excluded; this is a best-effort minimization boundary, not a general-purpose secret scanner.

Risk and technical severity remain deterministic. Human disposition remains separate from machine conclusions. API readback exposes only validated structured results and safe status/error codes for the current occurrence/evidence pair.

## Consequences
- Lower token cost and better grounding.
- AI quality depends on evidence quality.
- Additional asynchronous state is required for AI enrichment.
- Persisted results are idempotent for an occurrence, evidence snapshot, model, and prompt version.
- This implementation is an optional explanation/investigation layer, not a general AI analysis platform.
