# BugZero documentation

This directory contains the authoritative design and implementation-status documents for the BugZero architecture and persistence model.

## Primary references

- [PRD.md](PRD.md) — product intent, problem statement, and scope for the repository review platform.
- [SYSTEM_DESIGN.md](SYSTEM_DESIGN.md) — technical architecture source of truth.
- [DATABASE_DESIGN.md](DATABASE_DESIGN.md) — PostgreSQL persistence model and schema semantics.
- [adr/README.md](adr/README.md) — architecture decision records.
- [API.md](API.md) — API boundary summary.
- [ARCHITECTURE.md](ARCHITECTURE.md) — high-level component map.
- [CODE_IR.md](CODE_IR.md) — semantic Code IR scope.
- [FINDINGS.md](FINDINGS.md) — finding identity and occurrence model.
- [EVIDENCE.md](EVIDENCE.md) — evidence graph and authority semantics.
- [ANALYZERS.md](ANALYZERS.md) — analyzer architecture and status.

## Status

The repository currently contains an implementation foundation rather than a finished end-to-end product. The architecture documents intentionally distinguish between implemented capabilities, partial work, and planned future layers.

The design is intentionally explicit about boundaries: deterministic analysis is authoritative; AI remains bounded enrichment; repository intelligence is derived state, not source-of-truth; and historical records remain append-only.
