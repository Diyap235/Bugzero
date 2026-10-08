# BugZero --- System Design v1

**Status:** Architecture Frozen\
**Document Type:** Technical Source of Truth\
**Version:** 1.0\
**Last Updated:** 2026-10-07

------------------------------------------------------------------------

## 1. Purpose

This document defines the technical architecture of **BugZero**, an
AI-powered continuous code intelligence and review platform.

BugZero is not an AI chatbot for code.

BugZero builds a persistent, version-aware understanding of a software
repository, detects problems using deterministic analysis, connects
findings to technical evidence, calculates risk, and uses AI as a
bounded enrichment and investigation layer.

The implementation must follow this document.

### Architecture authority rule

The implementation order is:

``` text
PRD
  ↓
SYSTEM_DESIGN.md
  ↓
ADR
  ↓
Contracts / Schemas
  ↓
Implementation
  ↓
Tests
  ↓
Benchmarks
```

If implementation conflicts with this document:

1.  Stop implementation.
2.  Report the conflict.
3.  Review the architecture.
4.  Update this document or an ADR explicitly.
5.  Continue only after the decision is recorded.

Developers and coding agents must not silently invent architecture.

------------------------------------------------------------------------

# 2. System Goals

BugZero must:

1.  Understand large software repositories.
2.  Build a persistent repository intelligence model.
3.  Support Python and JavaScript/TypeScript initially.
4.  Parse source code into a semantic Code IR.
5.  Build important program relationships.
6.  Detect security, quality, and dependency problems.
7.  Represent findings independently from source line numbers.
8.  Preserve finding history across commits and refactors.
9.  Generate versioned technical evidence.
10. Distinguish authoritative evidence from investigative evidence.
11. Calculate deterministic technical risk.
12. Support incremental analysis.
13. Analyze changed code and affected code separately.
14. Continue operating when AI is unavailable.
15. Support asynchronous analysis.
16. Protect BugZero from malicious repositories.
17. Support progressive analysis for large repositories.
18. Provide a foundation capable of targeting 1M+ LOC.
19. Maintain reproducible analysis results.
20. Keep human decisions separate from machine conclusions.

------------------------------------------------------------------------

# 3. Non-Goals for v1

The following are explicitly outside the first implementation slice:

-   Full autonomous code fixing.
-   Autonomous AI security decisions.
-   Support for many programming languages.
-   Kubernetes-first deployment.
-   Kafka-first event architecture.
-   Neo4j or another graph database as a mandatory dependency.
-   Full dynamic execution of arbitrary repositories.
-   Hundreds of analyzers.
-   Perfect architectural reconstruction.
-   Multi-region enterprise deployment.
-   Fully autonomous remediation.
-   Claiming verified 1M+ LOC performance before benchmarks exist.

These may be introduced later through explicit architecture decisions.

------------------------------------------------------------------------

# 4. Architecture Principles

## 4.1 Source of Truth

Source code is authoritative in the Git repository at a specific commit.

Derived intelligence is rebuildable from:

``` text
Source Repository
+
Commit SHA
+
Analyzer Version
+
Analysis Profile
```

------------------------------------------------------------------------

## 4.2 Deterministic First

Whenever a technical conclusion can be established deterministically,
deterministic analysis is authoritative.

AI is an enrichment and reasoning layer.

``` text
Deterministic Analysis
        ↓
Technical Evidence
        ↓
Finding
        ↓
Risk
        ↓
AI Explanation / Investigation
```

AI must not freely invent confirmed vulnerabilities.

------------------------------------------------------------------------

## 4.3 Evidence First

A finding should be explainable through technical evidence.

A useful finding should answer:

-   What happened?
-   Where did it happen?
-   Why is it a problem?
-   What code relationship caused it?
-   How confident is the system?
-   Is the evidence complete?
-   What revision was analyzed?

------------------------------------------------------------------------

## 4.4 Minimum Safe Computation

BugZero does not attempt to compute everything on every change.

However:

> BugZero must never reduce computation so aggressively that an
> unresolved relationship could invalidate a conclusion.

Therefore:

``` text
Need less computation?
        ↓
Can uncertainty affect conclusion?
   ┌────┴────┐
   No       Yes
   ↓         ↓
Continue   Expand analysis
```

------------------------------------------------------------------------

## 4.5 Historical Immutability

Historical analysis results are immutable.

New analysis creates new assessments.

Never rewrite historical evidence to make it appear as though the old
analysis had the new knowledge.

------------------------------------------------------------------------

# 5. System Context

``` text
                         ┌──────────────────────┐
                         │       GitHub         │
                         └──────────┬───────────┘
                                    │
                            Git + Provider API
                                    │
                                    ↓
                         ┌──────────────────────┐
                         │ Repository Ingestion │
                         └──────────┬───────────┘
                                    ↓
                           Commit Snapshot
                                    ↓
                         ┌──────────────────────┐
                         │ Repository Intelligence│
                         └──────────┬───────────┘
                                    ↓
                              Semantic Code IR
                                    ↓
                         Analysis Orchestrator
                                    ↓
                ┌───────────────────┼───────────────────┐
                ↓                   ↓                   ↓
            Security             Quality           Dependency
            Analysis             Analysis           Analysis
                └───────────────────┼───────────────────┘
                                    ↓
                            Unified Findings
                                    ↓
                             Evidence Graph
                                    ↓
                           Deterministic Risk
                                    ↓
                         ┌──────────┴──────────┐
                         ↓                     ↓
                    Core Result           AI Enrichment
                         └──────────┬──────────┘
                                    ↓
                              Health / History
                                    ↓
                             API / PR / UI
```

------------------------------------------------------------------------

# 6. High-Level Component Architecture

## 6.1 Product Platform

The product platform is implemented primarily in TypeScript.

``` text
apps/web
apps/api
apps/workers
packages/*
```

### Responsibilities

-   Authentication
-   Organizations
-   Repository integration
-   API
-   Authorization
-   Analysis job orchestration
-   Persistence
-   Webhooks
-   Reports
-   Health
-   Finding lifecycle
-   User-facing workflows

------------------------------------------------------------------------

# 7. Code Intelligence Platform

The intelligence engine is implemented in Python.

``` text
engine/
├── parser
├── code_ir
├── intelligence
├── analyzers
├── evidence
├── findings
├── risk
└── ai
```

### Principle

> TypeScript owns the product. Python owns code intelligence.

The Python engine must not become an uncontrolled second product
backend.

------------------------------------------------------------------------

# 8. Repository Ingestion

## 8.1 Repository Source

BugZero uses:

**Git clone + provider APIs**

Git provides:

-   Source files
-   Commits
-   Branches
-   Tags
-   Commit SHAs
-   Diffs
-   History

Provider APIs provide:

-   Repository metadata
-   Pull requests
-   Reviews
-   Comments
-   Webhooks
-   Permissions
-   Integration metadata

------------------------------------------------------------------------

## 8.2 Repository Storage

Repositories are stored using:

``` text
Git/Object Storage
        ↓
Ephemeral Worker Workspace
        ↓
Parse / Analyze
        ↓
Persistent Intelligence
```

Worker workspaces are temporary.

PostgreSQL is not used as the primary source-code store.

------------------------------------------------------------------------

## 8.3 Repository Revision Identity

Repository state is identified by:

``` text
repository_id
+
commit_sha
```

Derived intelligence is versioned against the commit.

``` text
Commit A → Intelligence A
Commit B → Intelligence B
Commit C → Intelligence C
```

The full repository is not copied for every commit.

------------------------------------------------------------------------

# 9. Repository Intelligence Model

Repository Intelligence is a layered, version-aware model containing:

1.  Code structure.
2.  Program relationships.
3.  Dependency intelligence.
4.  Analysis state.
5.  Evidence state.
6.  Git/history information.
7.  Ownership information where available.
8.  Test/configuration context where available.

It is derived state.

It is not a single giant graph and it is not a trained AI model.

------------------------------------------------------------------------

## 9.1 Core Questions

Repository Intelligence must help answer:

1.  What exists?
2.  How is it connected?
3.  What does it depend on?
4.  What happened to it over time?
5.  What does BugZero already know about it?

------------------------------------------------------------------------

## 9.2 Relationship Uncertainty

Relationships may have:

``` text
EXACT
INFERRED
POSSIBLE
UNKNOWN
```

Relationships should carry:

-   Confidence
-   Provenance
-   Analyzer/source
-   Revision
-   Staleness

Uncertainty must not automatically mean exclusion.

If uncertainty can materially affect a conclusion, analysis scope should
expand.

------------------------------------------------------------------------

# 10. Semantic Code IR

## 10.1 Purpose

The Code IR is the stable semantic representation consumed by analyzers.

It is not intended to become a universal copy of source code.

Principle:

> Code IR preserves semantics needed for correctness; it does not
> attempt to become a universal representation of every source-language
> detail.

------------------------------------------------------------------------

## 10.2 Pipeline

``` text
Source
  ↓
Language Detection
  ↓
Language-specific AST/CST
  ↓
Language Adapter
  ↓
Semantic Code IR
  ↓
Analysis
```

------------------------------------------------------------------------

## 10.3 Core Entities

The Code IR must be able to represent:

-   Repository
-   File
-   Module
-   Namespace
-   Class
-   Function
-   Method
-   Variable
-   Parameter
-   Type
-   Constant

------------------------------------------------------------------------

## 10.4 Core Relationships

Important relationships include:

``` text
IMPORTS
DECLARES
CALLS
REFERENCES
READS
WRITES
RETURNS
PASSES_ARGUMENT
INHERITS
IMPLEMENTS
OVERRIDES
DEPENDS_ON
```

------------------------------------------------------------------------

## 10.5 Semantic Facts

Where supported, the IR can represent:

``` text
CONTROL_FLOW
DATA_FLOW
SOURCE
SINK
SANITIZER
EXTERNAL_API
DATABASE_OPERATION
FILE_OPERATION
PROCESS_EXECUTION
AUTHENTICATION
AUTHORIZATION
```

------------------------------------------------------------------------

## 10.6 Provenance

IR entities and relationships should retain source provenance:

-   File
-   Start line
-   End line
-   Start column where available
-   End column where available
-   Commit SHA
-   Language
-   Parser/analyzer version

------------------------------------------------------------------------

## 10.7 Expensive Derived Structures

Not every expensive representation must be persisted permanently.

Examples:

-   Full CFG
-   Full data-flow graph
-   Large temporary graph expansions

These may be generated on demand and cached when useful.

Permanent storage should prioritize canonical semantic facts and
high-value relationships.

------------------------------------------------------------------------

# 11. Analysis Architecture

Detection uses a layered analyzer architecture.

``` text
Code IR
   ↓
Analysis Orchestrator
   ├── Structural Rules
   ├── Data-flow / Taint
   ├── Dependency Analysis
   ├── Graph Analysis
   └── Specialized Security Analysis
             ↓
      Deterministic Findings
             ↓
          Evidence
             ↓
           Risk
```

------------------------------------------------------------------------

## 11.1 Analyzer Contract

Every analyzer must define:

-   Name
-   Version
-   Type
-   Supported languages
-   Required IR capabilities
-   Analysis scope
-   Resource cost
-   Confidence model
-   Output types
-   Evidence requirements
-   Incremental-analysis support

------------------------------------------------------------------------

## 11.2 Analyzer Categories

Initial categories:

``` text
Structural
Security
Taint / Data Flow
Dependency
Quality
```

------------------------------------------------------------------------

# 12. Initial Analyzer Scope

BugZero v1 should begin with a small number of meaningful analyzer
families.

Examples:

### Security

-   SQL injection / unsafe query construction
-   Command injection
-   Hardcoded secrets

### Quality

-   Structural correctness/quality rules
-   Complexity or maintainability rule

### Dependency

-   Known vulnerable dependency detection

The architecture must support additional analyzers without redesigning
the finding model.

------------------------------------------------------------------------

# 13. Analysis Scope

BugZero distinguishes:

``` text
Changed LOC
```

from:

``` text
Affected LOC
```

Changed code does not automatically equal the complete analysis scope.

------------------------------------------------------------------------

## 13.1 Impact Analysis

For an incremental analysis:

``` text
Commit
  ↓
Diff
  ↓
Changed Files
  ↓
Changed Symbols
  ↓
Dependency / Call Relationships
  ↓
Affected Scope
  ↓
Minimum Safe Analysis
```

If an unresolved relationship could materially affect the conclusion,
the analysis scope expands.

------------------------------------------------------------------------

# 14. Initial Repository Analysis

BugZero uses progressive analysis.

``` text
Repository Connected
        ↓
Fast Structural Intelligence
        ↓
Initial High-confidence Results
        ↓
Background Deep Analysis
        ↓
Complete Baseline
```

The exact strategy is adaptive based on:

-   Repository size
-   Languages
-   Repository structure
-   Analyzer cost
-   Available resources
-   Existing intelligence
-   Analysis profile

A large repository must not require the user to wait for every expensive
analyzer before seeing all useful information.

------------------------------------------------------------------------

# 15. Hot Path / Cold Path

## 15.1 Hot Path

Used for PR and interactive workflows.

``` text
PR
 ↓
Diff
 ↓
Impact Analysis
 ↓
Targeted Analysis
 ↓
Evidence
 ↓
PR Result
```

Priority is low latency.

------------------------------------------------------------------------

## 15.2 Cold Path

Used for repository-wide intelligence.

``` text
Repository
 ↓
Deep Analysis
 ↓
Graph Construction
 ↓
History
 ↓
Architecture Intelligence
 ↓
Health
```

Priority is completeness and depth.

------------------------------------------------------------------------

# 16. Analysis Status and Coverage

BugZero must never claim an analysis is complete when it is not.

Analysis must expose capability-level state.

Examples:

``` text
PARSING
SECURITY_ANALYSIS
QUALITY_ANALYSIS
DEPENDENCY_ANALYSIS
EVIDENCE
RISK
AI_ENRICHMENT
```

Possible states:

``` text
NOT_STARTED
RUNNING
COMPLETED
PARTIAL
FAILED
UNAVAILABLE
```

------------------------------------------------------------------------

## 16.1 Coverage Dimensions

Coverage is not only percentage of files analyzed.

BugZero should eventually distinguish:

-   File coverage
-   Symbol coverage
-   Critical-path coverage
-   Security-sensitive coverage
-   Dependency coverage
-   Analyzer coverage

------------------------------------------------------------------------

# 17. Analysis Job System

The API must not block while large repositories are analyzed.

``` text
POST /reviews
      ↓
202 Accepted
      ↓
review_id
      ↓
Queue
      ↓
Workers
```

------------------------------------------------------------------------

## 17.1 Queue

v1:

**Redis + BullMQ**

This is an implementation choice for the initial job system.

A different queue may be introduced later only through an architecture
decision.

------------------------------------------------------------------------

## 17.2 Job Hierarchy

Analysis is divided into meaningful stages.

``` text
Analysis Run
    │
    ├── Ingestion
    ├── Parsing
    ├── IR Construction
    ├── Dependency Analysis
    ├── Security Analysis
    ├── Quality Analysis
    ├── Evidence
    ├── Risk
    └── AI Enrichment
```

Stages may execute independently or concurrently where dependencies
permit.

------------------------------------------------------------------------

# 18. Job Idempotency

Every analysis operation must have a deterministic identity based on
relevant inputs.

Conceptually:

``` text
repository
+
commit
+
analysis_profile
+
analyzer_version
+
scope
```

creates an analysis identity.

If a worker retries the same operation:

``` text
Existing result?
   ├── YES → reuse
   └── NO  → execute
```

Database uniqueness constraints must protect against duplicate
persistence.

------------------------------------------------------------------------

# 19. Failure Handling

Jobs use:

-   Retry
-   Exponential backoff
-   Failure classification
-   Dead-letter handling
-   Audit information

Example:

``` text
Job
 ↓
RUNNING
 ↓
Failure
 ↓
Retry
 ↓
Retry limit
 ↓
DEAD LETTER
```

A single analyzer failure must not automatically destroy the complete
repository analysis.

Partial analysis must be explicitly represented.

------------------------------------------------------------------------

# 20. Finding System

## 20.1 Finding Identity

Finding identity is semantic.

Do not use:

``` text
file + line
```

as the finding identity.

Do not rely only on source hash.

Finding identity considers:

-   Rule
-   Semantic target
-   Relevant relationship/evidence
-   Normalized code fingerprint
-   History
-   Repository context

------------------------------------------------------------------------

## 20.2 Finding and Occurrence

A finding represents the underlying issue.

An occurrence represents that issue at a particular repository revision.

``` text
F-123
 ├── Occurrence @ Commit A
 ├── Occurrence @ Commit B
 └── Occurrence @ Commit C
```

A refactor can move or rename code while preserving the same finding
identity if semantic continuity is established.

------------------------------------------------------------------------

## 20.3 Matching

Finding matching must return:

``` text
SAME
NEW
UNKNOWN
```

If continuity cannot be established safely:

> Do not silently merge.

------------------------------------------------------------------------

# 21. Finding State

The Finding stores a current derived projection.

It may include:

-   Current occurrence
-   Current severity
-   Current confidence
-   Current risk
-   Current status
-   Last seen revision

Historical occurrences preserve their historical assessment.

------------------------------------------------------------------------

# 22. Finding Lifecycle

Lifecycle:

``` text
OPEN
CONFIRMED
IN_PROGRESS
RESOLVED
DISMISSED
REOPENED
```

------------------------------------------------------------------------

## 22.1 Observation State

Observation is separate from lifecycle.

Possible observation states:

``` text
DETECTED
NOT_DETECTED
PARTIALLY_ANALYZED
ANALYSIS_INCOMPLETE
ANALYSIS_FAILED
NOT_APPLICABLE
```

Critical rule:

> NOT_DETECTED does not mean RESOLVED.

Resolution requires positive evidence that the condition has been
removed by a sufficiently complete successful analysis.

------------------------------------------------------------------------

# 23. Authority Model

BugZero separates:

### Machine Analysis

What technical evidence supports.

### Human Disposition

What the organization decides.

### Lifecycle

Operational state of the finding.

Machine evidence may support:

``` text
OPEN → CONFIRMED
CONFIRMED → RESOLVED
```

The second transition requires sufficiently complete positive evidence.

Humans may make organizational decisions such as:

``` text
CONFIRMED → DISMISSED
RESOLVED → REOPENED
```

Human actions must be audited.

------------------------------------------------------------------------

# 24. Severity and Priority

Technical severity and organizational priority are different.

## Machine Assessment

-   Technical Severity
-   Confidence
-   Evidence Strength
-   Exploitability
-   Reachability
-   Technical Risk

## Human Decision

-   Business Priority
-   Accepted Risk
-   Exception
-   Disposition

Human organizational decisions must not erase technical assessment.

------------------------------------------------------------------------

# 25. Evidence Architecture

Evidence is a first-class technical object.

Principle:

> Evidence is a versioned technical proof object internally; source
> locations and snippets are human-readable projections of that
> evidence.

------------------------------------------------------------------------

## 25.1 Evidence Layers

``` text
Evidence Fact
      ↓
Evidence Path
      ↓
Evidence Snapshot
      ↓
Evidence Graph
```

The internal representation is graph-based because program behavior can
branch and converge.

The UI can present human-readable paths.

------------------------------------------------------------------------

# 26. Evidence Graph

Evidence graph nodes can represent:

-   Source
-   Variable
-   Function
-   Call
-   Transformation
-   Sanitizer
-   Sink
-   External boundary
-   Database operation
-   File operation
-   Process execution

Edges represent relationships in the evidence path.

Example:

``` text
HTTP_INPUT
    ↓
user_input
    ↓
processRequest()
    ↓
buildQuery()
    ↓
db.execute()
```

------------------------------------------------------------------------

# 27. Evidence Authority

BugZero uses two evidence tiers.

## Authoritative Evidence

Created or validated by deterministic analysis.

Can support technical truth and confirmed findings.

## Investigative Evidence

Produced by:

-   AI
-   Heuristics
-   Exploratory analysis

Status:

``` text
UNVERIFIED
```

Investigative evidence cannot become authoritative merely because an AI
model is confident.

Promotion requires appropriate validation.

``` text
Proposed Evidence
      ↓
Deterministic Validation
      ↓
Validated
      ↓
Authoritative Evidence
```

------------------------------------------------------------------------

# 28. Unresolved Evidence

Example:

``` text
HTTP_INPUT
    ↓
user_input
    ↓
???
    ↓
db.execute()
```

BugZero stores partial evidence.

Then:

``` text
Could uncertainty affect conclusion?
       │
   ┌───┴───┐
   No      Yes
   ↓        ↓
Store     Expand
partial   analysis
evidence    ↓
          Resolve?
          ├── Yes → stronger evidence
          └── No  → incomplete evidence
```

Incomplete evidence must never be presented as fully proven.

------------------------------------------------------------------------

# 29. Evidence Immutability

Historical evidence is immutable.

If a later analyzer improves understanding:

``` text
Commit A
  └── Evidence E1

Analyzer v2
  └── Evidence E2
```

E1 remains available for historical reproducibility.

------------------------------------------------------------------------

# 30. Evidence Retention

Use tiered retention.

Persist:

-   Finding-associated evidence
-   Critical security evidence
-   Evidence required for audit/reporting
-   Historical evidence needed to reproduce findings

Cache or regenerate:

-   Temporary analysis artifacts
-   Low-value exploratory paths
-   Large derived structures that are cheap enough to recreate

------------------------------------------------------------------------

# 31. Risk Engine

Risk is deterministic.

Inputs can include:

``` text
Technical Severity
Confidence
Evidence Strength
Exploitability
Reachability
Affected Modules
Dependency Exposure
```

Technical risk is separate from organizational risk.

Risk must not be delegated to an LLM.

------------------------------------------------------------------------

# 32. AI Architecture

AI is optional enrichment.

AI may perform:

-   Explanation
-   Remediation suggestions
-   Investigation
-   Finding classification
-   False-positive assistance
-   Architecture reasoning

AI does not become the authority for deterministic technical truth.

------------------------------------------------------------------------

# 33. AI Context Boundary

AI must receive a bounded Evidence Package.

``` text
Finding
 ↓
Evidence Graph
 ↓
Relevant Code IR
 ↓
Relevant source snippets
 ↓
Dependencies
 ↓
Relevant history
 ↓
Bounded Evidence Package
 ↓
AI
```

Never send an entire 1M+ LOC repository to an LLM.

------------------------------------------------------------------------

# 34. AI Failure Model

Core BugZero analysis must work when AI is unavailable.

Possible AI states:

``` text
AVAILABLE
RATE_LIMITED
TIMEOUT
INVALID_RESPONSE
UNAVAILABLE
DISABLED
```

If AI fails:

``` text
Deterministic Analysis
        ↓
Findings
        ↓
Evidence
        ↓
Risk
        ↓
Health
```

AI explanation can be retried asynchronously.

AI failure does not invalidate deterministic findings.

------------------------------------------------------------------------

# 35. Untrusted Repository Security

Repositories must be treated as untrusted input.

The API server must never execute repository code.

Default analysis is static.

Future build/test/dynamic capabilities require sandboxed execution.

------------------------------------------------------------------------

## 35.1 Execution Boundary

``` text
Execution Request
      ↓
Resource Policy
      ↓
Sandbox
      ↓
Repository Code
```

------------------------------------------------------------------------

## 35.2 Sandbox Requirements

Execution environments should support:

-   Container isolation
-   Restricted privileges
-   Read-only source where possible
-   CPU limits
-   Memory limits
-   Disk limits
-   Execution timeout
-   Process limits
-   File limits
-   Output limits
-   Network restrictions

Stronger isolation such as gVisor or Firecracker may be introduced later
if threat-model and scale requirements justify it.

------------------------------------------------------------------------

# 36. Network Policy

Repository execution has:

**No network by default.**

Allow network only for explicitly approved capabilities.

This protects against:

-   Data exfiltration
-   Malicious callbacks
-   Command-and-control
-   Dependency attacks
-   Unauthorized external communication

------------------------------------------------------------------------

# 37. Resource Management

Every analysis must operate under a resource budget.

Budgets can include:

``` text
CPU
Memory
Disk
Wall-clock time
Process count
File count
Network
AI tokens/cost
```

Analysis must stop safely when its budget is exhausted.

The resulting state must indicate incomplete analysis rather than
pretending completion.

------------------------------------------------------------------------

# 38. Persistence Architecture

## Primary Database

**PostgreSQL**

Use PostgreSQL for transactional BugZero state:

-   Users
-   Organizations
-   Members
-   Repositories
-   Repository commits
-   Analysis jobs/runs
-   Findings
-   Finding occurrences
-   Evidence metadata
-   Dependencies
-   Health snapshots
-   Reports
-   Audit logs

------------------------------------------------------------------------

## 38.1 Code Intelligence Storage

v1 uses a hybrid approach:

``` text
PostgreSQL
+
Specialized indexes
+
Object storage
+
Cache
```

Do not introduce a graph database by default.

If actual workload benchmarks demonstrate that PostgreSQL-based
relationship traversal is insufficient, a specialized graph/index layer
may be considered through an ADR.

------------------------------------------------------------------------

# 39. Canonical Data Rules

  Data                  Canonical Source
  --------------------- ---------------------------
  Source code           Git commit
  Repository metadata   PostgreSQL
  Code IR               Derived from source
  Evidence              Immutable analysis result
  Findings              Finding system
  Health                Derived snapshot
  Search indexes        Rebuildable derived state
  Cache                 Never authoritative
  AI explanation        Derived enrichment

------------------------------------------------------------------------

# 40. Large Repository Storage

Do not permanently store every possible representation.

Avoid:

``` text
Every AST
+
Every CFG
+
Every data-flow edge
+
Every temporary graph expansion
```

for every repository revision.

Prefer:

``` text
Canonical semantic facts
+
Important persistent relationships
+
Derived indexes
+
On-demand expensive analysis
+
Cache
```

------------------------------------------------------------------------

# 41. Multi-Tenancy

v1 uses:

``` text
Shared PostgreSQL
+
organization_id
+
authorization
+
Row Level Security where appropriate
```

Tenant-owned entities must maintain organization context.

Cross-tenant data access must be impossible through normal application
paths.

------------------------------------------------------------------------

# 42. Roles

Initial roles:

``` text
OWNER
ADMIN
DEVELOPER
SECURITY_REVIEWER
VIEWER
```

Backend authorization is authoritative.

Frontend visibility is not a security boundary.

------------------------------------------------------------------------

# 43. Secrets

Secrets must not be stored as ordinary plaintext database values.

Sensitive credentials include:

-   GitHub OAuth tokens
-   GitHub installation credentials
-   API keys
-   AI provider credentials
-   Webhook secrets

Requirements:

-   Encryption at rest
-   Encryption in transit
-   Scoped credentials
-   Rotation
-   Revocation
-   Audit logging
-   Least privilege

------------------------------------------------------------------------

# 44. Deployment Model

v1 deployment target:

**Docker Compose**

Expected components:

``` text
Next.js
Fastify API
Python Engine / Workers
PostgreSQL
Redis
Object Storage / MinIO
```

Kubernetes is intentionally deferred.

------------------------------------------------------------------------

# 45. Scaling Boundaries

Components should be independently scalable:

``` text
API
Parser Workers
Security Workers
Dependency Workers
AI Workers
```

API capacity must not determine analysis capacity.

------------------------------------------------------------------------

# 46. Concurrency Control

For many large repositories, BugZero must use:

-   Resource-aware scheduling
-   Tenant quotas
-   Queue priorities
-   Analysis budgets
-   Worker concurrency limits
-   Database protection
-   AI cost budgets

Priority should generally favor:

``` text
PR / interactive analysis
        ↑
Interactive investigation
        ↑
Background deep analysis
```

------------------------------------------------------------------------

# 47. Observability

BugZero uses logs, metrics, and traces.

OpenTelemetry is the preferred instrumentation boundary.

Measure at minimum:

-   Analysis duration
-   Queue latency
-   Queue depth
-   Analyzer failures
-   Parser failures
-   Retry counts
-   Coverage
-   Evidence completeness
-   Finding counts
-   Worker CPU
-   Worker memory
-   Database latency
-   Redis latency
-   AI latency
-   AI cost
-   Resource-limit failures

------------------------------------------------------------------------

# 48. API Architecture

The Fastify API is the product boundary.

The API should:

-   Authenticate requests
-   Authorize access
-   Validate input using Zod
-   Create/update product state
-   Queue asynchronous work
-   Return analysis status
-   Expose findings
-   Expose evidence
-   Expose health
-   Expose reports
-   Handle webhooks

The API must not perform long-running repository analysis synchronously.

------------------------------------------------------------------------

# 49. API Analysis Lifecycle

Example:

``` text
POST /reviews
      ↓
202 Accepted
      ↓
review_id
      ↓
QUEUED
      ↓
RUNNING
      ↓
PARSING
      ↓
ANALYZING
      ↓
CORRELATING
      ↓
ENRICHING
      ↓
COMPLETED
```

Failure states:

``` text
FAILED
 ↓
RETRY
 ↓
DEAD LETTER
```

------------------------------------------------------------------------

# 50. Health Model

Repository health is derived from analysis results.

Health dimensions include:

``` text
Security
Quality
Reliability
Maintainability
Dependencies
```

Health snapshots must be tied to repository revisions.

Health history must remain queryable.

------------------------------------------------------------------------

# 51. Continuous Intelligence

Continuous intelligence is driven by repository changes.

``` text
GitHub Push / PR
       ↓
Webhook
       ↓
Changed Commit
       ↓
Diff
       ↓
Impact Analysis
       ↓
Targeted Analysis
       ↓
Findings
       ↓
Evidence
       ↓
Risk
       ↓
Health
       ↓
PR / Dashboard
```

------------------------------------------------------------------------

# 52. Incremental Analysis

Incremental analysis must reuse existing repository intelligence.

Conceptually:

``` text
Base Snapshot
      +
Change Overlay
      ↓
Affected Intelligence
      ↓
Targeted Analysis
```

BugZero should avoid reprocessing the entire repository when the change
does not require it.

------------------------------------------------------------------------

# 53. Caching

Content hashes and analysis identities should support caching.

Potential cache keys:

``` text
file_hash
+
parser_version
```

or:

``` text
repository
+
commit
+
analyzer
+
analyzer_version
+
scope
```

Cache is an optimization.

Cache must never become the authoritative source of truth.

------------------------------------------------------------------------

# 54. Finding History

Finding history is represented through immutable occurrences.

Example:

``` text
Finding F-123

Commit A
  → detected
  → severity high

Commit B
  → moved
  → still same semantic issue

Commit C
  → condition removed
  → resolved
```

The history must remain explainable.

------------------------------------------------------------------------

# 55. Human Review

Human actions are separate from machine conclusions.

Every human disposition should record:

-   Actor
-   Timestamp
-   Previous state
-   New state
-   Reason
-   Optional comment
-   Relevant revision

Human decisions must never delete the underlying machine evidence.

------------------------------------------------------------------------

# 56. Testing Strategy

## Unit Tests

Test:

-   Parser adapters
-   Code IR
-   Analyzer rules
-   Finding identity
-   Finding matching
-   Severity
-   Risk scoring
-   Evidence completeness
-   Evidence validation
-   Resource policies

------------------------------------------------------------------------

## Integration Tests

Test:

``` text
API → Database
API → Redis
Worker → Database
Analysis → Findings
Evidence → Finding
Finding → Health
```

------------------------------------------------------------------------

## End-to-End Tests

Target workflow:

``` text
GitHub Repository
       ↓
Import
       ↓
Analyze
       ↓
Finding
       ↓
Evidence
       ↓
Risk
       ↓
API
       ↓
Developer UI
```

------------------------------------------------------------------------

# 57. Benchmark Strategy

Performance claims must be benchmark-backed.

Benchmark sizes:

``` text
10K LOC
100K LOC
500K LOC
1M LOC
```

Measure:

-   Ingestion time
-   Parse time
-   IR build time
-   Analysis time
-   Memory usage
-   CPU usage
-   Database load
-   Queue latency
-   Evidence generation
-   Finding generation
-   Incremental analysis time

Do not advertise verified 1M LOC support until these measurements exist.

------------------------------------------------------------------------

# 58. MVP Vertical Slice

BugZero v1 should implement one strong vertical slice:

``` text
GitHub
   ↓
Repository Ingestion
   ↓
Commit Snapshot
   ↓
Python + JavaScript/TypeScript Parser
   ↓
Semantic Code IR
   ↓
Repository Intelligence
   ↓
Deterministic Analyzer Families
   ↓
Unified Findings
   ↓
Evidence Graph
   ↓
Deterministic Risk
   ↓
AI Evidence Explanation
   ↓
Fastify API
   ↓
Developer UI
```

------------------------------------------------------------------------

# 59. MVP Analyzer Scope

Initial analyzer families:

``` text
1. Structural / Quality
2. Security / Taint
3. Dependency
```

Start small and prove the architecture before expanding rule coverage.

------------------------------------------------------------------------

# 60. Explicitly Deferred

The following are intentionally deferred:

-   Additional programming languages
-   Dynamic execution
-   Advanced sandbox isolation
-   Distributed queue replacement
-   Graph database
-   Kubernetes
-   Multi-region infrastructure
-   Autonomous remediation
-   Large-scale AI agent workflows
-   Massive analyzer catalog
-   Advanced ownership intelligence
-   Full architecture reconstruction

Deferred does not mean rejected.

Deferred means the current system must not depend on them.

------------------------------------------------------------------------

# 61. Repository Structure

``` text
bugzero/
├── apps/
│   ├── web/
│   ├── api/
│   └── workers/
│
├── packages/
│   ├── contracts/
│   ├── database/
│   └── config/
│
├── engine/
│   ├── parser/
│   ├── code_ir/
│   ├── intelligence/
│   ├── analyzers/
│   ├── evidence/
│   ├── findings/
│   ├── risk/
│   └── ai/
│
├── infrastructure/
│   ├── docker/
│   ├── postgres/
│   ├── redis/
│   ├── minio/
│   └── compose/
│
├── db/
├── tests/
├── docs/
│   └── adr/
```

------------------------------------------------------------------------

# 62. Technology Ownership

  Area                  Technology
  --------------------- ------------------------------------------
  Frontend              Next.js / React / TypeScript
  API                   Fastify / TypeScript
  Validation            Zod
  Workers               TypeScript / BullMQ
  Queue                 Redis + BullMQ
  Database              PostgreSQL
  Object Storage        S3-compatible / MinIO
  Intelligence Engine   Python
  Parsing               AST / Tree-sitter adapters
  AI                    OpenAI through bounded evidence packages
  Containers            Docker
  Observability         OpenTelemetry + logs/metrics/traces

------------------------------------------------------------------------

# 63. Architecture Decision Records

The following ADRs define major decisions:

``` text
ADR-001 — Product Platform / Intelligence Boundary
ADR-002 — Modular Monolith + Scalable Workers
ADR-003 — Semantic Code IR
ADR-004 — Semantic Finding Identity
ADR-005 — Evidence Model
ADR-006 — Analysis Job Architecture
ADR-007 — AI Boundary
```

Additional ADRs are required when introducing a major architectural
change.

------------------------------------------------------------------------

# 64. Definition of Done for Architecture Foundation

The foundation is considered ready for implementation when:

-   [x] Repository structure exists.
-   [x] Product/intelligence boundary is defined.
-   [x] Repository revision model is defined.
-   [x] Code IR direction is defined.
-   [x] Analyzer architecture is defined.
-   [x] Finding identity is defined.
-   [x] Finding lifecycle is defined.
-   [x] Evidence model is defined.
-   [x] Risk boundary is defined.
-   [x] AI boundary is defined.
-   [x] Job model is defined.
-   [x] Failure model is defined.
-   [x] Security boundary is defined.
-   [x] Persistence strategy is defined.
-   [x] Incremental analysis is defined.
-   [x] Scaling direction is defined.
-   [x] Observability requirements are defined.
-   [x] MVP boundary is defined.

------------------------------------------------------------------------

# 65. Implementation Rule

From this point onward:

> **Do not build a feature merely because it is technically possible.
> Build it because it belongs to the defined BugZero architecture and
> MVP path.**

The implementation should proceed in small vertical slices.

Every slice must have:

``` text
Contract
 ↓
Implementation
 ↓
Unit Tests
 ↓
Integration Tests
 ↓
Observability
 ↓
Documentation
```

Architecture changes must be explicit.

------------------------------------------------------------------------

# 66. Final Architecture Statement

BugZero is a **version-aware repository intelligence system**.

Its core pipeline is:

``` text
SOURCE
  ↓
INGEST
  ↓
PARSE
  ↓
SEMANTIC CODE IR
  ↓
REPOSITORY INTELLIGENCE
  ↓
DETERMINISTIC ANALYSIS
  ↓
FINDINGS
  ↓
EVIDENCE GRAPH
  ↓
DETERMINISTIC RISK
  ↓
HEALTH / HISTORY
  ↓
BOUNDED AI ENRICHMENT
  ↓
DEVELOPER ACTION
```

The central architectural objective is:

> **Maintain a correct, versioned model of a changing repository while
> performing the minimum computation necessary to produce safe,
> evidence-backed conclusions.**

This principle governs scalability, incremental analysis, evidence
completeness, finding identity, AI usage, and future architecture
decisions.

------------------------------------------------------------------------

**End of BugZero System Design v1**
