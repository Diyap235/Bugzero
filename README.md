# BugZero

> **Your code has a story.**

BugZero is a code intelligence platform that analyzes real codebases, detects security issues using deterministic analysis, collects evidence, calculates risk, and presents the results in a developer-focused interface.

## Core Workflow

```text
ZIP Codebase
    ↓
Ingestion → Parsing → Semantic Code IR
    ↓
Repository Intelligence
    ↓
Deterministic Analysis
    ↓
Findings + Evidence + Risk
    ↓
Optional ML Signal / NVIDIA-assisted Review
    ↓
PostgreSQL → API → Frontend
```

## Core Principles

- **Evidence over claims**
- **Deterministic analysis is authoritative**
- **Fail closed** — unresolved flows do not become fabricated findings
- **Unknown is better than guessed**
- **AI and ML are investigative layers, not sources of truth**
- **Frontend data comes from real persisted analysis results**

## Current Capabilities

- Real ZIP codebase upload
- Repository creation and analysis
- Source parsing and Semantic Code IR
- Repository Intelligence
- Deterministic **SQL Injection** analysis
- Cross-file analysis
- Evidence and risk assessment
- Code health and analysis history
- Finding Intelligence
- Optional ML investigative signal
- Optional NVIDIA-assisted source review and score estimates
- JWT authentication

## Security Analysis

The current deterministic security focus is **SQL Injection**.

BugZero requires a real data flow to a database sink before reporting an authoritative finding.

```text
User Input → Data Flow → SQL Construction → Database Sink → Finding
```

SQL-looking code without a real sink is not automatically reported.

## AI & ML

**ML:** Provides an investigative signal for supported Python functions and methods. It cannot create findings or modify deterministic evidence or risk.

**NVIDIA-assisted review:** Examines bounded source and dependency-manifest excerpts and provides cited suggestions and explicitly estimated health scores. It cannot create authoritative findings or change deterministic evidence and risk.

## Architecture

```text
Frontend
   ↓
API
   ├── PostgreSQL
   └── PostgreSQL durable queue
             ↓
           Worker
             ↓
      Parser → Code IR
             ↓
   Repository Intelligence
             ↓
    Deterministic Analysis
             ↓
    Finding / Evidence / Risk
             ↓
       ML / NVIDIA-assisted review (optional)
```

## Tech Stack

- **Frontend:** Next.js, React, TypeScript
- **API:** Node.js, TypeScript
- **Worker:** Node.js, TypeScript
- **Database:** Neon PostgreSQL
- **Queue:** PostgreSQL-backed atomic job claiming, retries, and leases
- **Code Intelligence:** Python + TypeScript
- **ML:** CodeBERT + scikit-learn
- **AI:** NVIDIA API (worker-side only)
- **Auth:** JWT / Ed25519
- **Package Manager:** pnpm

## Local Development

Requirements: Node.js 22.9 or newer, pnpm, Python, and a Neon development branch. A local PostgreSQL server is not required.

Install:

```bash
pnpm install
```

Start API:

```bash
pnpm --filter @bugzero/api dev
```

In development, the API starts the local worker automatically. Do not start a
second standalone worker alongside it. Production deployments should run the
API and a standalone worker as separate processes.

Start frontend:

```bash
pnpm dev
```

The API and worker require `DATABASE_URL` for tenant-scoped analysis. The worker additionally requires `DATABASE_QUEUE_URL` and `DATABASE_QUEUE_LOCK_URL` for queue claims; both must use the dedicated, non-`BYPASSRLS` `bugzero_queue_worker` login. Apply migrations to the intended Neon development branch before starting either service. Use `DATABASE_URL_UNPOOLED` only for migration execution. Keep database URLs and `NVIDIA_API_KEY` in `.env.local` or a secret manager and never commit them. See [deployment and environment setup](docs/DEPLOYMENT.md).

## Testing

The offline test suite covers ZIP ingestion, safe and vulnerable SQL examples, evidence, risk and health formulas, job retries, and relational graph persistence. Live database migration, tenant-isolation, queue-role, and end-to-end API/UI acceptance require a disposable Neon branch with all ordered migrations applied and the dedicated queue-worker login configured; those checks are not implied by the unit suite.

The verified path is:

```text
Real ZIP → Parser → Code IR → Analyzer → Finding
         → Evidence → Risk → Database → API → Frontend
```

## Scope

BugZero focuses on making its existing analysis pipeline **correct, explainable, evidence-backed, and trustworthy** rather than implementing every possible vulnerability or enterprise feature.

> **Your code has a story. BugZero helps you understand it — with evidence, not guesses.**
