import type { PoolClient } from 'pg';

export type OrganizationId = string;
export type RepositoryId = string;
export type CommitId = string;
export type UserId = string;
export type AnalysisRunId = string;
export type FindingId = string;
export type EvidenceId = string;

export interface DatabasePoolConfig {
  connectionString?: string;
  max?: number;
  idleTimeoutMillis?: number;
  connectionTimeoutMillis?: number;
}

export interface TenantContext {
  organizationId: OrganizationId;
}

export interface DatabaseTransactionContext extends TenantContext {
  client: PoolClient;
}
