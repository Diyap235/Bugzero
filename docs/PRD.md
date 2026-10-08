# BugZero Product Requirements Document

## Status

This document captures the product intent and implementation boundary for the current BugZero repository. It reflects the architecture and design decisions captured in `docs/SYSTEM_DESIGN.md`, the ADRs, and the existing schema and contracts. It does not describe a finished commercial product.

## Product vision

BugZero is a repository review platform focused on repository intelligence, deterministic code analysis, and evidence-backed findings. Its goal is to build a durable, version-aware model of a codebase so that engineering teams can understand repository state, changed behavior, impacted code, and technical risk without relying on ad hoc manual review.

## Problem statement

Large repositories are difficult to reason about with raw file inspection alone. The same code may be duplicated across modules, refactored across commits, or only indirectly connected to a safety issue. A review system needs to track code semantics, repository relationships, and historical evidence across revisions.

BugZero addresses that problem by modeling repository structure and relationships as first-class data, then allowing deterministic analysis to produce findings, evidence, and risk assessments that remain interpretable across time.

## Target users

- engineering teams reviewing repository health or change impact
- maintainers validating code before merge or release
- teams tracking repository-level risk across commits
- reviewers who need evidence rather than opaque warnings

## Core workflow

1. ingest a repository or commit snapshot
2. parse files into a semantic Code IR
3. build repository intelligence across entities and relationships
4. analyze changed and impacted code for quality, security, and dependency issues
5. produce findings with evidence and provenance
6. calculate risk and health signals from derived analysis
7. support human review and future AI enrichment without replacing deterministic evidence

## Repository integration

BugZero is repository-centric and version-aware. Source code remains authoritative in Git at a specific commit, while BugZero stores derived analysis state in the PostgreSQL persistence model and rebuildable indexes. The system is designed around commit-scoped analysis so that findings and evidence can be interpreted relative to a particular repository state.

## Repository intelligence

Repository intelligence is a first-class capability in the architecture. It includes:

- entity lookup by name, type, file, or qualified path
- relationship traversal across callers/callees and imports
- dependency-aware graph building
- bounded impact analysis for changed code
- unresolved relationship tracking
- completeness information and commit scoping

This is documented in the repository intelligence contracts and PostgreSQL query layer and belongs to the current implementation foundation.

## Semantic Code IR

The system's semantic representation of source code is a core architectural concept. It is not a raw text index; it is a structured representation of code entities, relationships, and key facts. The Code IR is designed to support repository intelligence, finding generation, and impact analysis without requiring a brittle file-by-file heuristic model.

## Static analysis, security analysis, dependency analysis

The architecture explicitly distinguishes deterministic analysis from AI enrichment. The intended layering is:

- parser and semantic extraction
- quality and security analysis
- dependency analysis
- finding and evidence generation
- risk assessment

In the current repository, the architecture and database contracts define the rule set and persistence model, but a full production analyzer stack is not yet implemented.

## Findings and evidence

Findings are formulated independently from raw file paths and line numbers. Their identity is semantic and version-aware. Occurrences record where and when a finding was observed. Evidence is versioned and may be authoritative or investigative depending on origin and completeness.

This distinction is central to the design and is enforced in the schema and ADRs.

## AI boundary

AI is treated as a bounded enrichment layer, not as the source of truth for vulnerabilities or technical conclusions. AI-generated explanations may help with investigation, but they do not convert investigative evidence into authoritative evidence.

## Risk and health

The platform aims to provide deterministic technical risk and repository health signals derived from findings and evidence. Historical snapshots are retained to measure regressions and support comparison across revisions.

## Non-goals for the current slice

The current architecture explicitly excludes:

- autonomous code fixing
- fully autonomous security decisions
- broad multi-language expansion in the first slice
- a graph database-first requirement
- arbitrary dynamic execution of repository code
- production-scale 1M+ LOC validation claims without benchmarks

## Implementation status

| Area | Status |
| --- | --- |
| Product foundation | IMPLEMENTED |
| Repository intelligence v1 | IMPLEMENTED |
| Semantic Code IR v1 | IMPLEMENTED |
| Impact analysis foundations | IMPLEMENTED |
| PostgreSQL canonical model | IMPLEMENTED |
| Contracts and DTO validation | IMPLEMENTED |
| Deterministic Structural/Quality analyzers | IMPLEMENTED |
| SQL injection security rule v1 | IMPLEMENTED (partial language/data-flow coverage) |
| Other Security/Taint families | PLANNED |
| AI explanation | PLANNED |
| End-to-end autonomous remediation | DEFERRED |

## Summary

BugZero's current repository is best understood as the foundation for a deterministic, version-aware code intelligence platform. The project already defines the repository model, persistence semantics, and architectural boundaries needed for a larger implementation, while acknowledging that the complete analyzer and review pipeline is still under active development.
