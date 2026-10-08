# Semantic Code IR

## Status

**IMPLEMENTED (bounded parser capabilities).** The analysis-job processor parses the source at the run's exact Git commit and upserts commit-scoped entities/relationships through the existing Code IR repositories before building Repository Intelligence.

## Current semantic output

- **JavaScript/TypeScript:** TypeScript compiler AST parsing for function declarations, methods with bodies, named function expressions, and variable/property-assigned named arrows/functions. Entity spans use AST source offsets; functions/methods carry file path, kind, and qualified name where a name is available. Parameter entities and `DECLARES` edges are generated from AST parameters. Variable entities/`DECLARES` and simple `READS` edges are emitted.
- **Python:** deterministic indentation/lexical parsing for ordinary functions, async functions, classes, parameters, and same-file direct calls. Source spans are based on observed declaration/body lines; no placeholder locations are generated.
- **Calls:** unique, direct, same-file function names (and unambiguous `this.method()` in JS/TS) can produce exact `CALLS`. Relationships are persisted idempotently and are consumed by Repository Intelligence.
- **Evidence provenance:** persisted entity facts are attributed to `CODE_IR`; exact persisted relationship facts retain their `REPOSITORY_INTELLIGENCE` origin and original parser provenance. Evidence uses only `EXACT` edges for positive structural paths.
- **Security v1:** the SQL injection analyzer maps source expressions to scoped Code IR function entities and requires exact same-file `CALLS` relationships from Repository Intelligence for interprocedural JavaScript/TypeScript propagation. Expression-level assignments, SQL construction, and sink recognition are source-AST refinements; they are not persisted as new core IR relations. Python security support is a limited straight-line source subset and does not claim interprocedural propagation.
- Stable parser-generated entity keys allow retry-safe upserts for the same commit. The relationships use the same organization/repository/commit/source/target/kind uniqueness identity.

## Limitations

- Python is not parsed by a complete Python grammar. Complex decorators, type syntax, multiline constructs, indentation edge cases, and newer grammar features may be missed; parse diagnostics and partial status are used where detected.
- Direct call resolution is intentionally conservative. Dynamic dispatch, aliases, imported/cross-file functions, overloaded/ambiguous names, and unresolved targets remain unresolved and do not count as exact calls.
- TypeScript interfaces and declaration-only methods do not become body-bearing callable entities. `DEEP_NESTING` remains deferred because nesting depth is not reliably represented.
- This is static source parsing only. Repository code is never executed; runtime behavior, reflection, monkey-patching, generated code, and unsupported syntax are outside the current IR guarantees.
- Evidence nodes carry exact line spans from Code IR, but the current IR does not provide source columns. See [EVIDENCE.md](EVIDENCE.md) for evidence completeness and uncertainty semantics.
