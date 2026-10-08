import type { Pool } from 'pg';
import type { AIInvestigationResult } from '@bugzero/contracts';

import { getDatabasePool } from '../client/postgres.js';

export type AIInvestigationErrorCode =
  | 'MISSING_CONFIGURATION'
  | 'INVALID_CONFIGURATION'
  | 'TIMEOUT'
  | 'RATE_LIMITED'
  | 'PROVIDER_ERROR'
  | 'INVALID_RESPONSE'
  | 'CONTEXT_TOO_LARGE';

export interface AIInvestigationRecord {
  id: string;
  organization_id: string;
  finding_id: string;
  finding_occurrence_id: string;
  evidence_id: string;
  provider: 'GROQ';
  model: string;
  prompt_version: string;
  idempotency_key: string | null;
  status: 'PENDING' | 'COMPLETED' | 'FAILED';
  content: string | null;
  result: AIInvestigationResult | null;
  error_code: AIInvestigationErrorCode | null;
  created_at: string;
  updated_at: string;
}

export interface CreateAIInvestigationInput {
  organizationId: string;
  findingId: string;
  findingOccurrenceId: string;
  evidenceId: string;
  provider: 'GROQ';
  model: string;
  promptVersion: string;
  idempotencyKey: string;
  result: AIInvestigationResult | null;
  errorCode: AIInvestigationErrorCode | null;
}

export class AIInvestigationRepository {
  constructor(private readonly pool: Pool = getDatabasePool()) {}

  async getByIdempotencyKey(
    organizationId: string,
    occurrenceId: string,
    idempotencyKey: string,
  ): Promise<AIInvestigationRecord | null> {
    const result = await this.pool.query<AIInvestigationRecord>(
      `SELECT * FROM ai_explanations
       WHERE organization_id = $1 AND finding_occurrence_id = $2 AND idempotency_key = $3`,
      [organizationId, occurrenceId, idempotencyKey],
    );
    return result.rows[0] ?? null;
  }

  async createOrGet(input: CreateAIInvestigationInput): Promise<{ record: AIInvestigationRecord; created: boolean }> {
    const status = input.result ? 'COMPLETED' : 'FAILED';
    const inserted = await this.pool.query<AIInvestigationRecord>(
      `INSERT INTO ai_explanations (
        organization_id, finding_id, finding_occurrence_id, evidence_id,
        provider, model, prompt_version, idempotency_key, status,
        result, content, error_code
      )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (organization_id, finding_occurrence_id, idempotency_key)
         WHERE idempotency_key IS NOT NULL
       DO NOTHING
       RETURNING *`,
      [
        input.organizationId,
        input.findingId,
        input.findingOccurrenceId,
        input.evidenceId,
        input.provider,
        input.model,
        input.promptVersion,
        input.idempotencyKey,
        status,
        input.result,
        input.result ? JSON.stringify(input.result) : null,
        input.errorCode,
      ],
    );
    if (inserted.rows[0]) return { record: inserted.rows[0], created: true };

    const existing = await this.getByIdempotencyKey(
      input.organizationId,
      input.findingOccurrenceId,
      input.idempotencyKey,
    );
    if (!existing) throw new Error('AI investigation idempotency conflict could not be resolved');
    return { record: existing, created: false };
  }

  async getForOccurrence(organizationId: string, occurrenceId: string): Promise<AIInvestigationRecord[]> {
    const result = await this.pool.query<AIInvestigationRecord>(
      `SELECT * FROM ai_explanations
       WHERE organization_id = $1 AND finding_occurrence_id = $2
       ORDER BY created_at DESC, id`,
      [organizationId, occurrenceId],
    );
    return result.rows;
  }
}

export const aiInvestigationRepository = new AIInvestigationRepository();
