# ADR-007 — Evidence-Scoped AI Enrichment

- **Status:** Accepted
- **Date:** 2026-10-07
- **Decision:** AI is an asynchronous, bounded enrichment and investigation layer, never the authority for deterministic technical truth.

## Context
AI can help explain a persisted finding, but unconstrained repository scanning is unsafe, expensive, and difficult to reproduce.

## Decision
The optional worker-side advisory review runs after deterministic analysis. It receives a bounded selection of repository source excerpts and available dependency manifests; persisted finding explanations also receive bounded evidence graph elements and snippets around their recorded evidence.

The response is strict-schema validated. Repository suggestions and estimated health scores are advisory and distinct from deterministic scores, findings, evidence, and risk. Scores require citations to submitted files at valid line numbers; dependency scores require manifest citations. Per-finding explanations remain associated with the finding occurrence and evidence snapshot. Missing configuration, service errors, malformed output, and timeouts must not change deterministic results.

The NVIDIA API is optional and configured only in the worker environment with `NVIDIA_API_KEY` and `NVIDIA_MODEL`. Context, output tokens, excerpts, request timeout, and retries are bounded. Selected credential-like assignments, bearer tokens, URL credentials, private-key blocks, and sensitive paths are redacted or excluded. This is a best-effort minimization boundary, not a general-purpose secret scanner.

Risk and technical severity remain deterministic. Human disposition remains separate from machine conclusions. API readback exposes only validated structured results and safe status/error codes for the current occurrence/evidence pair.

## Consequences
- Lower token cost and better grounding.
- AI quality depends on evidence quality.
- Additional asynchronous state is required for AI enrichment.
- Persisted results are idempotent for an occurrence, evidence snapshot, model, and prompt version.
- This implementation is an optional explanation/investigation layer, not a general AI analysis platform.
