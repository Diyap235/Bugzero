# BugZero

BugZero is a repository intelligence and review platform under active architecture definition. The repository currently includes the architectural foundation for a statement-based, version-aware analysis system that tracks repositories, commits, files, code entities, relationships, findings, evidence, and health snapshots.

This workspace is not a completed production review product. It contains a PostgreSQL-first model, asynchronous API/worker analysis pipeline, deterministic Structural/Quality rules, a narrowly scoped SQL injection analyzer, evidence persistence, risk, and health calculation. The real database/Redis deployment and authenticated end-to-end path remain unverified.

## Current implementation status

| Capability | Status |
| --- | --- |
| Repository ingestion service v1 | IMPLEMENTED; API onboarding workflow absent |
| Semantic Code IR v1 | IMPLEMENTED with documented parser limits |
| Repository Intelligence v1 | IMPLEMENTED |
| Impact analysis / analysis scope foundations | IMPLEMENTED |
| PostgreSQL schema and repository adapters | IMPLEMENTED; tenant RLS context not wired or live-verified |
| Contracts layer | IMPLEMENTED |
| Deterministic Structural/Quality analyzer framework | IMPLEMENTED |
| SQL injection security rule v1 | IMPLEMENTED (partial language/data-flow coverage) |
| Other Security/Taint rules | PLANNED |
| Deterministic Risk Engine v1 | IMPLEMENTED; live database behavior unverified |
| Repository Health v1 | IMPLEMENTED; live database behavior unverified |
| API analysis create/status and product reads | IMPLEMENTED behind external trusted authentication |
| PostgreSQL/Redis/Docker deployment | NOT VERIFIED; Compose is currently a placeholder |
| Live API-to-worker real-repository end-to-end | NOT VERIFIED |
| AI explanation and enrichment | PLANNED |
| Full end-to-end autonomous review pipeline | DEFERRED |

## What exists in this repository

- `docs/SYSTEM_DESIGN.md` and `docs/adr/` define the architecture and ADRs.
- `db/migrations/0001`–`0007` define the PostgreSQL canonical schema and additive v1 analysis extensions.
- `packages/contracts` defines shared TypeScript contracts and DTO validation.
- `packages/database` provides PostgreSQL repository adapters; tenant RLS context remains to be wired.
- `apps/api` and `apps/workers` implement analysis dispatch, product reads, and the asynchronous analysis pipeline; the API needs an externally supplied trusted authentication adapter.
- `engine/` contains the analysis-engine directory layout for parser, code IR, findings, intelligence, evidence, risk, and AI layers.

## Architecture at a glance

```text
Repository
  ↓
Ingestion / commit snapshot
  ↓
Semantic Code IR
  ↓
Repository intelligence
  ↓
Impact analysis and scope
  ↓
Findings + evidence + risk
  ↓
API / UI / worker orchestration
```

BugZero intentionally separates source-of-truth repository content from derived analysis state. Findings are tied to semantic identity rather than raw file/line numbers, and evidence remains versioned and append-only.

## Repository structure

```text
BugZero/
├── apps/
│   ├── api/               # API workspace boundary
│   ├── web/               # Next.js product shell
│   └── workers/           # Async worker boundary
├── db/
│   └── migrations/        # Canonical PostgreSQL schema
├── docs/
│   ├── PRD.md             # product intent and scope
│   ├── SYSTEM_DESIGN.md   # source-of-truth architecture
│   ├── DATABASE_DESIGN.md # persistence model
│   ├── adr/               # architecture decisions
│   └── ...
├── engine/
│   ├── parser/
│   ├── code_ir/
│   ├── intelligence/
│   ├── findings/
│   ├── evidence/
│   ├── risk/
│   └── ai/
├── packages/
│   ├── contracts/
│   ├── database/
│   ├── shared/
│   └── config/
├── README.md
├── package.json
├── pnpm-workspace.yaml
└── docker-compose.yml
```

## Development

Install dependencies with the workspace package manager:

```bash
npm install
# or
pnpm install
```

Validate the TypeScript workspace:

```bash
pnpm typecheck
pnpm lint
pnpm test
```

## Important limitations

The current repository does not contain a general-purpose security analysis pipeline. SQL injection analysis is intentionally partial and only covers constructs documented in [docs/SECURITY.md](docs/SECURITY.md). The analysis pipeline has passed deterministic in-memory fixture tests, but live PostgreSQL migration, RLS, Redis/BullMQ, GitHub onboarding, API-to-worker integration, and Docker deployment have not been verified.

For the authoritative architecture and schema guidance, see:

- [docs/PRD.md](docs/PRD.md)
- [docs/SYSTEM_DESIGN.md](docs/SYSTEM_DESIGN.md)
- [docs/DATABASE_DESIGN.md](docs/DATABASE_DESIGN.md)
- [docs/adr/README.md](docs/adr/README.md)
- [packages/contracts/API_CONTRACTS.md](packages/contracts/API_CONTRACTS.md)

## License

This project is distributed under the MIT license.