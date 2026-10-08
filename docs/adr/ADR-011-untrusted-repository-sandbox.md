# ADR-011 — Layered Sandbox for Untrusted Repository Workloads

- **Status:** Accepted
- **Date:** 2026-10-07
- **Decision:** Static analysis is the default; executable repository workloads require an isolated sandbox.

## Context
Repositories may contain malicious build scripts, tests, dependencies, or commands. API processes must never execute repository code directly.

## Decision
Workers operate in isolated containers with restricted privileges, read-only source mounts where possible, CPU/memory/disk/time/process limits, bounded output, and no network by default. Future stronger isolation such as gVisor or Firecracker may be introduced through an explicit decision.

Dynamic build/test execution is opt-in and separate from static analysis.

## Consequences
- Reduced host compromise risk.
- Some legitimate builds may fail under restrictions.
- Sandbox policy must be observable and auditable.
