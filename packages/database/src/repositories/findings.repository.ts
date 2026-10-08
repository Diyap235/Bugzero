import type { Pool } from 'pg';

import { getDatabasePool } from '../client/postgres.js';

export type FindingLifecycle = 'OPEN' | 'CONFIRMED' | 'IN_PROGRESS' | 'RESOLVED' | 'DISMISSED' | 'REOPENED';
export type FindingSeverity = 'INFO' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type FindingConfidence = 'LOW' | 'MEDIUM' | 'HIGH';
export type ObservationType = 'DETECTED' | 'NOT_DETECTED' | 'PARTIALLY_ANALYZED' | 'ANALYSIS_INCOMPLETE' | 'ANALYSIS_FAILED' | 'NOT_APPLICABLE';

export interface Finding {
  id: string;
  organization_id: string;
  repository_id: string;
  rule_id: string;
  identity_fingerprint: string;
  identity_version: string;
  lifecycle: FindingLifecycle;
  current_occurrence_id: string | null;
  resolution_evidence_id: string | null;
  current_severity: FindingSeverity;
  current_confidence: FindingConfidence;
  current_risk: number;
  last_seen_commit_id: string | null;
  business_priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT' | null;
  accepted_risk: boolean;
  exception_id: string | null;
  disposition_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface FindingOccurrence {
  id: string;
  organization_id: string;
  finding_id: string;
  repository_id: string;
  commit_id: string;
  analysis_run_id: string;
  rule_id: string;
  semantic_target_id: string;
  normalized_fingerprint: string;
  relationship_fingerprint: string | null;
  file_path: string | null;
  start_line: number | null;
  end_line: number | null;
  observation: ObservationType;
  severity: FindingSeverity;
  confidence: FindingConfidence;
  evidence_strength: 'LOW' | 'MEDIUM' | 'HIGH' | 'UNKNOWN';
  exploitability: 'LOW' | 'MEDIUM' | 'HIGH' | 'UNKNOWN';
  reachability: 'LOW' | 'MEDIUM' | 'HIGH' | 'UNKNOWN';
  technical_risk: number;
  resolution: 'EXACT' | 'INFERRED' | 'POSSIBLE' | 'UNKNOWN';
  match_result: 'SAME' | 'NEW' | 'UNKNOWN';
  created_at: string;
}

export interface CreateFindingInput {
  organizationId: string;
  repositoryId: string;
  ruleId: string;
  identityFingerprint: string;
  identityVersion: string;
  lifecycle?: FindingLifecycle;
  currentSeverity: FindingSeverity;
  currentConfidence: FindingConfidence;
  currentRisk: number;
  lastSeenCommitId?: string | null;
  businessPriority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT' | null;
}

export interface CreateFindingOccurrenceInput {
  organizationId: string;
  findingId: string;
  repositoryId: string;
  commitId: string;
  analysisRunId: string;
  ruleId: string;
  semanticTargetId: string;
  normalizedFingerprint: string;
  relationshipFingerprint?: string | null;
  filePath?: string | null;
  startLine?: number | null;
  endLine?: number | null;
  observation: ObservationType;
  severity: FindingSeverity;
  confidence: FindingConfidence;
  evidenceStrength: 'LOW' | 'MEDIUM' | 'HIGH' | 'UNKNOWN';
  exploitability: 'LOW' | 'MEDIUM' | 'HIGH' | 'UNKNOWN';
  reachability: 'LOW' | 'MEDIUM' | 'HIGH' | 'UNKNOWN';
  technicalRisk: number;
  resolution: 'EXACT' | 'INFERRED' | 'POSSIBLE' | 'UNKNOWN';
  matchResult: 'SAME' | 'NEW' | 'UNKNOWN';
}

export interface CreateOrGetResult<T> {
  record: T;
  created: boolean;
}

export class FindingRepository {
  constructor(private readonly pool: Pool = getDatabasePool()) {}

  async getById(organizationId: string, findingId: string): Promise<Finding | null> {
    const result = await this.pool.query<Finding>(
      'SELECT * FROM findings WHERE organization_id = $1 AND id = $2',
      [organizationId, findingId],
    );
    return result.rows[0] ?? null;
  }

  async getByRepository(organizationId: string, repositoryId: string): Promise<Finding[]> {
    const result = await this.pool.query<Finding>(
      'SELECT * FROM findings WHERE organization_id = $1 AND repository_id = $2 ORDER BY created_at DESC',
      [organizationId, repositoryId],
    );

    return result.rows;
  }

  async create(input: CreateFindingInput): Promise<Finding> {
    const result = await this.pool.query<Finding>(
      `INSERT INTO findings (
        organization_id,
        repository_id,
        rule_id,
        identity_fingerprint,
        identity_version,
        lifecycle,
        current_severity,
        current_confidence,
        current_risk,
        last_seen_commit_id,
        business_priority
      )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [
        input.organizationId,
        input.repositoryId,
        input.ruleId,
        input.identityFingerprint,
        input.identityVersion,
        input.lifecycle ?? 'OPEN',
        input.currentSeverity,
        input.currentConfidence,
        input.currentRisk,
        input.lastSeenCommitId ?? null,
        input.businessPriority ?? null,
      ],
    );

    return result.rows[0];
  }

  async createOrGet(input: CreateFindingInput): Promise<CreateOrGetResult<Finding>> {
    const inserted = await this.pool.query<Finding>(
      `INSERT INTO findings (
        organization_id,
        repository_id,
        rule_id,
        identity_fingerprint,
        identity_version,
        lifecycle,
        current_severity,
        current_confidence,
        current_risk,
        last_seen_commit_id,
        business_priority
      )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (organization_id, repository_id, rule_id, identity_fingerprint) DO NOTHING
       RETURNING *`,
      [
        input.organizationId,
        input.repositoryId,
        input.ruleId,
        input.identityFingerprint,
        input.identityVersion,
        input.lifecycle ?? 'OPEN',
        input.currentSeverity,
        input.currentConfidence,
        input.currentRisk,
        input.lastSeenCommitId ?? null,
        input.businessPriority ?? null,
      ],
    );

    if (inserted.rows[0]) {
      return { record: inserted.rows[0], created: true };
    }

    const existing = await this.pool.query<Finding>(
      `SELECT * FROM findings
       WHERE organization_id = $1 AND repository_id = $2 AND rule_id = $3 AND identity_fingerprint = $4`,
      [input.organizationId, input.repositoryId, input.ruleId, input.identityFingerprint],
    );
    if (!existing.rows[0]) {
      throw new Error('Finding identity conflict occurred but the existing finding could not be loaded');
    }

    const refreshed = await this.pool.query<Finding>(
      `UPDATE findings
       SET current_severity = $2,
           current_confidence = $3,
           current_risk = $4,
           last_seen_commit_id = $5,
           updated_at = now()
       WHERE organization_id = $1 AND id = $6
       RETURNING *`,
      [
        input.organizationId,
        input.currentSeverity,
        input.currentConfidence,
        input.currentRisk,
        input.lastSeenCommitId ?? null,
        existing.rows[0].id,
      ],
    );
    if (!refreshed.rows[0]) {
      throw new Error('Existing finding could not be refreshed after identity match');
    }

    return { record: refreshed.rows[0], created: false };
  }

  async updateCurrentRisk(organizationId: string, findingId: string, currentRisk: number): Promise<void> {
    if (!Number.isFinite(currentRisk) || currentRisk < 0 || currentRisk > 100) {
      throw new Error('Current technical risk must be a finite number between 0 and 100');
    }
    const result = await this.pool.query(
      `UPDATE findings
       SET current_risk = $3, updated_at = now()
       WHERE organization_id = $1 AND id = $2`,
      [organizationId, findingId, currentRisk],
    );
    if (result.rowCount !== 1) throw new Error('Finding current risk could not be updated');
  }

  async createOccurrence(input: CreateFindingOccurrenceInput): Promise<FindingOccurrence> {
    const result = await this.pool.query<FindingOccurrence>(
      `INSERT INTO finding_occurrences (
        organization_id,
        finding_id,
        repository_id,
        commit_id,
        analysis_run_id,
        rule_id,
        semantic_target_id,
        normalized_fingerprint,
        relationship_fingerprint,
        file_path,
        start_line,
        end_line,
        observation,
        severity,
        confidence,
        evidence_strength,
        exploitability,
        reachability,
        technical_risk,
        resolution,
        match_result
      )
       VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
         $13, $14, $15, $16, $17, $18, $19, $20, $21
       )
       RETURNING *`,
      [
        input.organizationId,
        input.findingId,
        input.repositoryId,
        input.commitId,
        input.analysisRunId,
        input.ruleId,
        input.semanticTargetId,
        input.normalizedFingerprint,
        input.relationshipFingerprint ?? null,
        input.filePath ?? null,
        input.startLine ?? null,
        input.endLine ?? null,
        input.observation,
        input.severity,
        input.confidence,
        input.evidenceStrength,
        input.exploitability,
        input.reachability,
        input.technicalRisk,
        input.resolution,
        input.matchResult,
      ],
    );

    return result.rows[0];
  }

  async createOccurrenceIfAbsent(input: CreateFindingOccurrenceInput): Promise<CreateOrGetResult<FindingOccurrence>> {
    const inserted = await this.pool.query<FindingOccurrence>(
      `INSERT INTO finding_occurrences (
        organization_id,
        finding_id,
        repository_id,
        commit_id,
        analysis_run_id,
        rule_id,
        semantic_target_id,
        normalized_fingerprint,
        relationship_fingerprint,
        file_path,
        start_line,
        end_line,
        observation,
        severity,
        confidence,
        evidence_strength,
        exploitability,
        reachability,
        technical_risk,
        resolution,
        match_result
      )
       VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
         $13, $14, $15, $16, $17, $18, $19, $20, $21
       )
       ON CONFLICT DO NOTHING
       RETURNING *`,
      [
        input.organizationId,
        input.findingId,
        input.repositoryId,
        input.commitId,
        input.analysisRunId,
        input.ruleId,
        input.semanticTargetId,
        input.normalizedFingerprint,
        input.relationshipFingerprint ?? null,
        input.filePath ?? null,
        input.startLine ?? null,
        input.endLine ?? null,
        input.observation,
        input.severity,
        input.confidence,
        input.evidenceStrength,
        input.exploitability,
        input.reachability,
        input.technicalRisk,
        input.resolution,
        input.matchResult,
      ],
    );

    if (inserted.rows[0]) {
      return { record: inserted.rows[0], created: true };
    }

    const existing = await this.pool.query<FindingOccurrence>(
      `SELECT * FROM finding_occurrences
       WHERE organization_id = $1
         AND finding_id = $2
         AND commit_id = $3
         AND normalized_fingerprint = $4
       ORDER BY created_at ASC
       LIMIT 1`,
      [input.organizationId, input.findingId, input.commitId, input.normalizedFingerprint],
    );
    if (existing.rows[0]) {
      return { record: existing.rows[0], created: false };
    }

    const sameRun = await this.pool.query<FindingOccurrence>(
      `SELECT * FROM finding_occurrences
       WHERE organization_id = $1 AND finding_id = $2 AND analysis_run_id = $3
       LIMIT 1`,
      [input.organizationId, input.findingId, input.analysisRunId],
    );
    if (!sameRun.rows[0]) {
      throw new Error('Occurrence uniqueness conflict occurred but the existing occurrence could not be loaded');
    }

    return { record: sameRun.rows[0], created: false };
  }

  async getOccurrencesForFinding(organizationId: string, findingId: string): Promise<FindingOccurrence[]> {
    const result = await this.pool.query<FindingOccurrence>(
      'SELECT * FROM finding_occurrences WHERE organization_id = $1 AND finding_id = $2 ORDER BY created_at DESC',
      [organizationId, findingId],
    );

    return result.rows;
  }
}

export const findingsRepository = new FindingRepository();
