import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const migrationsDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../db/migrations');

test('finding occurrence migration enforces cross-run idempotency on semantic execution identity', async () => {
  const migration = await readFile(path.join(migrationsDirectory, '0003_finding_occurrence_idempotency.sql'), 'utf8');
  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS finding_occurrences_replay_identity_unique/i);
  assert.match(migration, /organization_id\s*,\s*finding_id\s*,\s*commit_id\s*,\s*normalized_fingerprint/i);
  assert.match(migration, /BEGIN;/i);
  assert.match(migration, /COMMIT;/i);
});

test('Code IR relationship migration matches the repository upsert conflict key', async () => {
  const migration = await readFile(path.join(migrationsDirectory, '0004_code_relationship_idempotency.sql'), 'utf8');
  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS code_relationships_semantic_identity_unique/i);
  assert.match(migration, /organization_id\s*,\s*repository_id\s*,\s*commit_id\s*,\s*source_entity_id\s*,\s*target_entity_id\s*,\s*relation/i);
});

test('versioned evidence migration adds occurrence identity, completeness, source spans, and uniqueness', async () => {
  const migration = await readFile(path.join(migrationsDirectory, '0005_versioned_evidence_graph.sql'), 'utf8');
  assert.match(migration, /ADD COLUMN identity_fingerprint text/i);
  assert.match(migration, /ADD COLUMN completeness text/i);
  assert.match(migration, /ADD COLUMN diagnostics jsonb/i);
  assert.match(migration, /ADD COLUMN end_line integer/i);
  assert.match(migration, /ADD COLUMN start_column integer/i);
  assert.match(migration, /evidence_occurrence_identity_unique/i);
  assert.match(migration, /organization_id\s*,\s*finding_occurrence_id\s*,\s*identity_fingerprint/i);
  assert.match(migration, /BEGIN;/i);
  assert.match(migration, /COMMIT;/i);
});

test('risk migration stores immutable versioned assessments linked to their evidence and occurrence', async () => {
  const migration = await readFile(path.join(migrationsDirectory, '0006_deterministic_risk_assessments.sql'), 'utf8');
  assert.match(migration, /CREATE TABLE risk_assessments/i);
  assert.match(migration, /profile_id text/i);
  assert.match(migration, /profile_version integer/i);
  assert.match(migration, /risk_assessments_immutable/i);
  assert.match(migration, /risk_assessments_repository_revision_idx/i);
  assert.match(migration, /UNIQUE \(organization_id, finding_occurrence_id, profile_id, profile_version\)/i);
  assert.match(migration, /REFERENCES evidence \(organization_id, finding_id, finding_occurrence_id, id\)/i);
  assert.match(migration, /'UNKNOWN'/i);
  assert.match(migration, /BEGIN;/i);
  assert.match(migration, /COMMIT;/i);
});

test('health migration extends immutable snapshots with profile idempotency and unknown-capable dimensions', async () => {
  const migration = await readFile(path.join(migrationsDirectory, '0007_repository_health_v1.sql'), 'utf8');
  assert.match(migration, /ALTER TABLE health_snapshots/i);
  assert.match(migration, /ALTER COLUMN security_score DROP NOT NULL/i);
  assert.match(migration, /ADD COLUMN overall_status text/i);
  assert.match(migration, /ADD COLUMN coverage text/i);
  assert.match(migration, /ADD COLUMN dimensions jsonb/i);
  assert.match(migration, /ADD COLUMN analysis_run_id uuid/i);
  assert.match(migration, /health_snapshots_analysis_run_fk/i);
  assert.match(migration, /health_snapshots_profile_revision_unique/i);
  assert.match(migration, /WHERE profile_id IS NOT NULL/i);
  assert.match(migration, /health_snapshots_profile_history_idx/i);
  assert.match(migration, /COMMIT;/i);
});
