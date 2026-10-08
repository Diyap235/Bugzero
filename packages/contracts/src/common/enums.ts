import { z } from 'zod';

export const UUID = z.string().uuid();
export const Sha256 = z.string().regex(/^[a-f0-9]{64}$/i, 'Expected SHA-256 hex');
export const GitCommitSha = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i, 'Expected Git commit SHA');

export const OrganizationRole = z.enum(['OWNER','ADMIN','DEVELOPER','SECURITY_REVIEWER','VIEWER']);
export const RepositoryProvider = z.enum(['GITHUB']);
export const AnalysisStatus = z.enum(['NOT_STARTED','RUNNING','COMPLETED','PARTIAL','FAILED','UNAVAILABLE']);
export const AnalysisStage = z.enum(['INGESTION','PARSING','CODE_IR','INTELLIGENCE','SECURITY_ANALYSIS','QUALITY_ANALYSIS','DEPENDENCY_ANALYSIS','EVIDENCE','RISK','AI_ENRICHMENT']);
export const AnalysisScope = z.enum(['REPOSITORY','COMMIT','CHANGED_FILES','AFFECTED_SYMBOLS','PR']);
export const FindingLifecycle = z.enum(['OPEN','CONFIRMED','IN_PROGRESS','RESOLVED','DISMISSED','REOPENED']);
export const ObservationState = z.enum(['DETECTED','NOT_DETECTED','PARTIALLY_ANALYZED','ANALYSIS_INCOMPLETE','ANALYSIS_FAILED','NOT_APPLICABLE']);
export const FindingMatch = z.enum(['SAME','NEW','UNKNOWN']);
export const EvidenceAuthority = z.enum(['AUTHORITATIVE','INVESTIGATIVE']);
export const EvidenceOrigin = z.enum(['DETERMINISTIC_ANALYZER','HEURISTIC','AI','HUMAN_VALIDATION']);
export const EvidenceSufficiency = z.enum(['SUFFICIENT','INSUFFICIENT','UNKNOWN']);
export const EvidenceCompleteness = z.enum(['COMPLETE','PARTIAL','INCOMPLETE']);
export const ResolutionState = z.enum(['EXACT','INFERRED','POSSIBLE','UNKNOWN']);
export const Severity = z.enum(['INFO','LOW','MEDIUM','HIGH','CRITICAL']);
export const Confidence = z.enum(['LOW','MEDIUM','HIGH']);
export const HealthDimension = z.enum(['SECURITY', 'QUALITY', 'DEPENDENCIES', 'RELIABILITY', 'MAINTAINABILITY']);
export const HealthBand = z.enum(['EXCELLENT', 'GOOD', 'FAIR', 'POOR', 'CRITICAL']);
export const HealthStatus = z.enum(['EXCELLENT', 'GOOD', 'FAIR', 'POOR', 'CRITICAL', 'UNKNOWN', 'PARTIAL']);
export const HealthCoverage = z.enum(['COMPLETE', 'PARTIAL', 'UNKNOWN']);
export const AnalyzerType = z.enum(['STRUCTURAL','SECURITY','TAINT','DEPENDENCY','QUALITY']);
export const JobState = z.enum(['QUEUED','RUNNING','COMPLETED','FAILED','RETRY','DEAD_LETTER','CANCELLED']);
export const UserRole = OrganizationRole;
