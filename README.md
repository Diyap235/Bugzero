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
Optional ML Signal / Groq Investigation
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
- Optional Groq investigation
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

**Groq:** Provides bounded investigation, explanation, and remediation guidance. It cannot create authoritative findings or change deterministic evidence and risk.

## Architecture

```text
Frontend
   ↓
API
   ├── PostgreSQL
   └── Redis / BullMQ
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
       ML / Groq (optional)
```

## Tech Stack

- **Frontend:** Next.js, React, TypeScript
- **API:** Node.js, TypeScript
- **Worker:** Node.js, TypeScript
- **Database:** PostgreSQL
- **Queue:** Redis + BullMQ
- **Code Intelligence:** Python + TypeScript
- **ML:** CodeBERT + scikit-learn
- **AI:** Groq
- **Auth:** JWT / Ed25519
- **Package Manager:** pnpm

## Local Development

Requirements: Node.js, pnpm, Python, PostgreSQL, and a Redis-compatible server.

Install:

```bash
pnpm install
```

Start API:

```bash
pnpm --filter @bugzero/api dev
```

Start worker:

```bash
node --env-file=.env.local --import tsx apps/workers/src/worker.ts
```

Start frontend:

```bash
pnpm dev
```

Keep secrets such as `DATABASE_URL` and `GROQ_API_KEY` in `.env.local` and never commit them.

## Testing

BugZero has been verified with real ZIP scenarios covering safe code, SQL Injection, SQL-like code without a sink, parameterized SQL, cross-file flows, mixed repositories, multiple findings, unresolved flows, realistic repositories, and edge cases.

The verified path is:

```text
Real ZIP → Parser → Code IR → Analyzer → Finding
         → Evidence → Risk → Database → API → Frontend
```

## Scope

BugZero focuses on making its existing analysis pipeline **correct, explainable, evidence-backed, and trustworthy** rather than implementing every possible vulnerability or enterprise feature.

> **Your code has a story. BugZero helps you understand it — with evidence, not guesses.**
