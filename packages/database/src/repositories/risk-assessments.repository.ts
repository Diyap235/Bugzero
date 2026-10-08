import type { Pool } from 'pg';

import { getDatabasePool } from '../client/postgres.js';

export type RiskBand = 'INFO' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type RiskDimension = 'LOW' | 'MEDIUM' | 'HIGH' | 'UNKNOWN';
export type RiskAuthority = 'AUTHORITATIVE' | 'INVESTIGATIVE' | 'UNKNOWN';
export type RiskSufficiency = 'SUFFICIENT' | 'INSUFFICIENT' | 'UNKNOWN';
export type RiskCompleteness = 'COMPLETE' | 'PARTIAL' | 'INCOMPLETE';

export interface RiskAssessmentRecord {
  id: string;
  organization_id: string;
  finding_id: string;
  finding_occurrence_id: string;
  evidence_id: string;
  repository_id: string;
  commit_id: string;
  analysis_run_id: string;
  profile_id: string;
  profile_version: number;
  model_version: string;
  severity: 'INFO' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  confidence: 'LOW' | 'MEDIUM' | 'HIGH';
  evidence_strength: RiskDimension;
  evidence_authority: RiskAuthority;
  evidence_sufficiency: RiskSufficiency;
  evidence_completeness: RiskCompleteness;
  reachability: RiskDimension;
  exploitability: RiskDimension;
  dependency_exposure: 'UNKNOWN';
  affected_module_count: null;
  technical_risk: number;
  risk_band: RiskBand;
  profile_snapshot: Record<string, unknown>;
  factors: Record<string, unknown>;
  calculation: Record<string, unknown>;
  explanation: string;
  assessed_at: string;
}

export interface CreateRiskAssessmentInput {
  organizationId: string;
  findingId: string;
  findingOccurrenceId: string;
  evidenceId: string;
  repositoryId: string;
  commitId: string;
  analysisRunId: string;
  profileId: string;
  profileVersion: number;
  modelVersion: string;
  severity: RiskAssessmentRecord['severity'];
  confidence: RiskAssessmentRecord['confidence'];
  evidenceStrength: RiskDimension;
  evidenceAuthority: RiskAuthority;
  evidenceSufficiency: RiskSufficiency;
  evidenceCompleteness: RiskCompleteness;
  reachability: RiskDimension;
  exploitability: RiskDimension;
  dependencyExposure: 'UNKNOWN';
  affectedModuleCount: null;
  technicalRisk: number;
  riskBand: RiskBand;
  profileSnapshot: Record<string, unknown>;
  factors: Record<string, unknown>;
  calculation: Record<string, unknown>;
  explanation: string;
}

export interface CreateOrGetRiskAssessmentResult {
  record: RiskAssessmentRecord;
  created: boolean;
}

export class RiskAssessmentRepository {
  constructor(private readonly pool: Pool = getDatabasePool()) {}

  async getForFinding(organizationId: string, findingId: string): Promise<RiskAssessmentRecord[]> {
    const result = await this.pool.query<RiskAssessmentRecord>(
      `SELECT * FROM risk_assessments
       WHERE organization_id = $1 AND finding_id = $2
       ORDER BY assessed_at DESC, id`,
      [organizationId, findingId],
    );
    return result.rows;
  }

  async createOrGet(input: CreateRiskAssessmentInput): Promise<CreateOrGetRiskAssessmentResult> {
    if (!Number.isFinite(input.technicalRisk) || input.technicalRisk < 0 || input.technicalRisk > 100) {
      throw new Error('Technical risk must be a finite number between 0 and 100');
    }
    const values = [
      input.organizationId,
      input.findingId,
      input.findingOccurrenceId,
      input.evidenceId,
      input.repositoryId,
      input.commitId,
      input.analysisRunId,
      input.profileId,
      input.profileVersion,
      input.modelVersion,
      input.severity,
      input.confidence,
      input.evidenceStrength,
      input.evidenceAuthority,
      input.evidenceSufficiency,
      input.evidenceCompleteness,
      input.reachability,
      input.exploitability,
      input.dependencyExposure,
      input.affectedModuleCount,
      input.technicalRisk,
      input.riskBand,
      input.profileSnapshot,
      input.factors,
      input.calculation,
      input.explanation,
    ];
    const inserted = await this.pool.query<RiskAssessmentRecord>(
      `INSERT INTO risk_assessments (
        organization_id, finding_id, finding_occurrence_id, evidence_id,
        repository_id, commit_id, analysis_run_id, profile_id, profile_version,
        model_version, severity, confidence, evidence_strength, evidence_authority,
        evidence_sufficiency, evidence_completeness, reachability, exploitability,
        dependency_exposure, affected_module_count, technical_risk, risk_band,
        profile_snapshot, factors, calculation, explanation
      )
       VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
         $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26
       )
       ON CONFLICT (organization_id, finding_occurrence_id, profile_id, profile_version) DO NOTHING
       RETURNING *`,
      values,
    );
    if (inserted.rows[0]) return { record: inserted.rows[0], created: true };

    const existing = await this.pool.query<RiskAssessmentRecord>(
      `SELECT * FROM risk_assessments
       WHERE organization_id = $1 AND finding_occurrence_id = $2
         AND profile_id = $3 AND profile_version = $4`,
      [input.organizationId, input.findingOccurrenceId, input.profileId, input.profileVersion],
    );
    if (!existing.rows[0]) throw new Error('Risk assessment identity conflict occurred but the existing record could not be loaded');
    return { record: existing.rows[0], created: false };
  }
}

export const riskAssessmentRepository = new RiskAssessmentRepository();
