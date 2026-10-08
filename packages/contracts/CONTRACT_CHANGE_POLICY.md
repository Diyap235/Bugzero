# Contract Change Policy

Shared contracts are versioned interfaces between separately deployed TypeScript services and the Python analysis engine. Changes must preserve the architecture in `docs/SYSTEM_DESIGN.md` and applicable ADRs.

## Before changing a contract

1. Check existing schemas and consumers; extend the existing domain shape rather than introducing a duplicate.
2. Keep the type serializable across TypeScript and Python. Document enum spellings, identifier formats, nullability, and timestamps.
3. Preserve tenant scope, immutable history, finding identity, evidence authority, and completeness semantics.
4. Never move business logic, persistence queries, analyzer code, credentials, or implementation-specific objects into the contracts package.

## Compatibility

- **Additive and optional:** normally compatible; consumers must tolerate absent values until all producers are updated.
- **Additive and required:** coordinate producers and consumers. Deploy producers only after consumers can accept the new field.
- **Breaking:** changing/removing a field, changing its meaning, tightening validation, or changing enum semantics requires a new contract version or an explicitly coordinated breaking release.
- **Enum expansion:** consumers must handle unknown/future values safely; do not map unknown analysis/evidence states to success or certainty.
- **Removal:** deprecate, measure consumer migration, then remove in a breaking release.

## Validation and release

- Update the Zod schema, inferred types, documentation, and all affected API/worker/engine adapters together.
- Add tests for validation and serialization compatibility at the boundary.
- Run `pnpm --filter @bugzero/contracts typecheck` and the repository's relevant checks.
- Review serialized examples for tenant scoping and ensure incomplete or investigative evidence cannot be represented as confirmed authoritative truth.
- Record architecture-level changes in an ADR before implementation; do not silently redefine the system design.
