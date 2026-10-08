# Frontend architecture

## Status

The current frontend is a Next.js application shell for the BugZero product. It is structured as a UI scaffold for repository review and repository-health concepts rather than a complete application backend or full review workflow.

## Current structure

The app is rooted under `src/` and organized by domain and feature boundary:

- `app/` — Next.js app router entries and page-level layout
- `components/` — reusable UI building blocks
- `domains/` — domain-specific state and modeling
- `hooks/` — client-side hooks
- `lib/` — utility and helper logic
- `services/` — API/service wrappers
- `types/` — domain TypeScript types

## Role in the system

The frontend is the presentation layer for the product architecture. It is expected to render repository data, findings, evidence summaries, health views, and reports but does not independently own the authoritative repository model or analysis engine.

## Implementation boundary

This frontend sits above the contracts and analysis architecture defined in `docs/SYSTEM_DESIGN.md`, `docs/DATABASE_DESIGN.md`, and `packages/contracts/`. It is intentionally decoupled from storage semantics and analysis logic.

## Current state

The codebase contains a UI skeleton and product landing experience, but not a completed end-to-end product layer. The runtime analysis pipeline, worker execution, and persistence services remain governed by the lower-level architecture and ADRs.
