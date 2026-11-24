# Semantic Code IR

## Status

**IMPLEMENTED (bounded parser capabilities; PostgreSQL persistence migration in progress).** The analysis-job processor parses the source at the run's exact Git commit and writes organization-, repository-, commit-, and analysis-run-scoped entities/relationships to PostgreSQL before building Repository Intelligence. Historical rows remain preserved with no analysis-run association.

Direct npm declarations from `package.json` and pip declarations from `requirements*.txt` are stored as dependency entities linked from their manifest FILE entity and mirrored into the tenant-scoped `dependencies` table. Repository Intelligence exposes these manifest declarations separately from dependency-to-dependency `dependencyEdges`; a manifest link is not treated as a transitive edge. Duplicate declarations are coalesced by package manager, package identity, and group, while distinct version constraints are preserved without selecting a resolved version. Requirements extras are retained. Lockfiles, `pyproject.toml`, `Pipfile`, and unsupported requirements entries produce partial-coverage diagnostics; transitive resolution is not modeled.

## Current semantic output

- **JavaScript/TypeScript:** TypeScript compiler AST parsing for function declarations, methods with bodies, named function expressions, and variable/property-assigned named arrows/functions. Entity spans use AST source offsets; functions/methods carry file path, kind, and qualified name where a name is available. Parameter entities and `DECLARES` edges are generated from AST parameters. Variable entities/`DECLARES` and simple `READS` edges are emitted.
- **Python:** the configured local Python interpreter's standard-library AST parser validates syntax and supplies source spans for classes, functions, methods, parameters, and unambiguous same-file direct calls. Simple functions, conditionals, loops, and class methods can be `PARSED`. `match`, `try`, `with`, async iteration/context managers, and lambdas currently produce `PARTIAL` diagnostics because their semantics are not fully represented in Code IR. Syntax errors include their source location; if AST validation cannot run, the legacy heuristic extraction is retained only as partial coverage.
- **Calls:** unique, direct, same-file function names (and unambiguous `this.method()` in JS/TS) can produce exact `CALLS`. Relationships are persisted idempotently and are consumed by Repository Intelligence.
- **Evidence provenance:** persisted entity facts are attributed to `CODE_IR`; exact persisted relationship facts retain their `REPOSITORY_INTELLIGENCE` origin and original parser provenance. Evidence uses only `EXACT` edges for positive structural paths.
- **Security v1:** the SQL injection analyzer maps source expressions to scoped Code IR function entities and uses exact same-file `CALLS` relationships from Repository Intelligence. It additionally resolves unambiguous named/default relative imports to exported JavaScript/TypeScript functions present in the loaded repository snapshot; those analyzer-local links are not persisted as core IR relations. Expression-level assignments, SQL construction, and sink recognition are source-AST refinements. Python security support is a limited straight-line source subset and does not claim interprocedural propagation.
- Stable parser-generated entity keys plus deterministic run-scoped IDs allow retry-safe PostgreSQL upserts. Every graph query and record includes organization, repository, commit, and analysis-run scope.

## Limitations

- Python syntax acceptance follows the installed interpreter's grammar version. Code IR remains a bounded structural representation, not a complete semantic model; unsupported constructs are reported as partial, and the heuristic fallback is never treated as complete.
- Persisted Code IR call resolution remains intentionally same-file. Dynamic dispatch, namespace imports, unsupported re-exports, overloaded/ambiguous names, and unresolved targets remain unresolved; the SQL analyzer's snapshot-local import resolver does not upgrade them into persisted Code IR relationships.
- TypeScript interfaces and declaration-only methods do not become body-bearing callable entities. `DEEP_NESTING` remains deferred because nesting depth is not reliably represented.
- This is static source parsing only. Repository code is never executed; runtime behavior, reflection, monkey-patching, generated code, and unsupported syntax are outside the current IR guarantees.
- Evidence nodes carry exact line spans from Code IR, but the current IR does not provide source columns. See [EVIDENCE.md](EVIDENCE.md) for evidence completeness and uncertainty semantics.
