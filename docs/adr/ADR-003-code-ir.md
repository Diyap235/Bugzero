# ADR-003 — Semantic Code IR

- **Status:** Accepted
- **Date:** 2026-10-07
- **Decision:** Use a semantic, language-neutral Code IR built from language-specific AST/CST adapters.

## Context
A universal AST would either leak language-specific details or become too weak for security and impact analysis.

## Decision
Pipeline: source → language adapter → semantic Code IR → repository intelligence → analyzers.

Core entities include repository, file, module, class, function/method, symbol, parameter, type, and constant. Core relationships include IMPORTS, DECLARES, CALLS, REFERENCES, READS, WRITES, RETURNS, PASSES_ARGUMENT, INHERITS, IMPLEMENTS, OVERRIDES, and DEPENDS_ON.

Semantic facts include sources, sinks, sanitizers, external APIs, database/file/process operations, and authentication/authorization boundaries. Every relationship carries provenance and resolution state where applicable.

Expensive CFG/data-flow structures are not required to live permanently in the core IR; they may be computed, cached, and versioned as analysis artifacts.

## Consequences
- Strong cross-language abstraction.
- Better incremental and impact analysis.
- IR design must evolve carefully because analyzers depend on it.
- Source code remains authoritative; IR is derived and rebuildable.
