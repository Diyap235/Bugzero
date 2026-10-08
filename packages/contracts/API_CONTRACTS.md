# BugZero Shared API Contracts

The Zod schemas exported by `src/index.ts` are the shared TypeScript boundary for the Fastify API, BullMQ workers, and serialized requests/results exchanged with the Python engine. They describe data only: no database queries, business workflows, or analyzer implementations belong here.

## Domain exports

| Domain | Schemas |
| --- | --- |
| `common` | UUID, content hash and Git commit SHA formats; analysis, job, finding, evidence, severity, confidence, and role enums |
| `organizations` | Organization, user identity, and organization membership |
| `repositories` | Repository metadata, commit revisions, repository files, and analysis profiles |
| `analysis` | Analysis run/job, capability status, and analysis request |
| `findings` | Finding identity fingerprint, occurrence, machine assessment, human disposition, and match result |
| `evidence` | Versioned evidence, evidence graph nodes/edges, AI explanation, and evidence sufficiency request |
| `risk` | Risk assessment and health snapshot |
| `reviews` | Review request and response |

Use the exported schemas at trust boundaries and infer TypeScript types from them rather than maintaining duplicate DTO definitions. A Git commit identifier accepts 40-character or 64-character Git object IDs; `Sha256` is specifically for SHA-256 content digests.

## Analysis API

- `POST /analysis` accepts `CreateAnalysisRequestSchema`: tenant-scoped repository ID, exact indexed commit SHA, optional existing profile ID, scope, changed file paths, and changed entity IDs. Organization authority comes from trusted authentication context, not the request body.
- Successful requests return HTTP 202 with `AcceptedAnalysisSchema` (`analysisRunId`, `jobId`, and queued job status); processing is asynchronous.
- The canonical BullMQ envelope is `AnalysisQueuePayloadSchema` with `{ organizationId, jobId }`. The worker adapter passes that exact envelope to `AnalysisJobProcessor` input.
- `GET /analysis/:runId` returns `AnalysisRunStatusResponseSchema` with run state, latest job stage/state, progress, timestamps, and a sanitized failure field.

## Tenant context

Tenant-owned records carry `organizationId`. Command/request schemas deliberately do not accept a caller-selected organization as authority. The API derives tenant context from the authenticated user's membership, authorizes the operation, and applies that trusted context to storage and worker jobs. Workers and the Python engine must receive the organization context in their serialized job envelope and preserve it in produced records.

Do not treat a valid UUID, repository ID, or job ID as proof of authorization. Every consumer must validate tenant ownership at the boundary.

## Finding and evidence semantics

- Finding identity uses a semantic fingerprint; location is occurrence metadata, not identity.
- `FindingLifecycle` is distinct from `ObservationState`; `NOT_DETECTED` does not mean `RESOLVED`.
- A resolution requires suitable positive evidence and a sufficiently complete successful analysis.
- Evidence includes revision/run identity, authority, sufficiency, and completeness.
- Evidence includes its origin. AI- and heuristic-origin evidence is investigative; authoritative evidence requires deterministic analysis or human validation.
- Historical occurrences and evidence are append-only versions.

## Boundary rules

- Contracts contain serializable data shapes and validation only.
- Database persistence and queries belong to `packages/database` / the API persistence boundary.
- Analysis and Python-specific types stay inside `engine` unless deliberately represented by a stable serialized contract.
- Do not expose secrets, source archives, or unbounded analysis artifacts through these DTOs.
