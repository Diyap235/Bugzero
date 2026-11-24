import test from 'node:test';
import assert from 'node:assert/strict';

import { loadMigrations, removeTransactionEnvelope } from '../src/migrate.js';

test('migration envelopes are removed so tracking and schema DDL share one transaction', () => {
  assert.equal(removeTransactionEnvelope('BEGIN;\nCREATE TABLE example (id int);\nCOMMIT;'), 'CREATE TABLE example (id int);');
  assert.throws(() => removeTransactionEnvelope('CREATE TABLE example (id int);'), /BEGIN\/COMMIT transaction envelope/);
});

test('canonical SQL migrations are loaded in numeric order with stable checksums', async () => {
  const migrations = await loadMigrations();
  assert.deepEqual(migrations.map((migration) => migration.filename), [
    '0001_bugzero_foundation.sql',
    '0002_repository_intelligence_indexes.sql',
    '0003_finding_occurrence_idempotency.sql',
    '0004_code_relationship_idempotency.sql',
    '0005_versioned_evidence_graph.sql',
    '0006_deterministic_risk_assessments.sql',
    '0007_repository_health_v1.sql',
    '0008_local_repository_snapshots.sql',
    '0009_account_onboarding.sql',
    '0010_ai_investigation_results.sql',
    '0011_remove_auth_refresh_sessions.sql',
    '0012_health_snapshot_run_idempotency.sql',
    '0013_nullable_unassessed_finding_risk.sql',
    '0014_postgres_queue_and_code_graph.sql',
    '0015_advisory_review_errors.sql',
    '0016_run_scoped_finding_occurrences.sql',
    '0017_secure_organization_invitations.sql',
  ]);
  assert.ok(migrations.every((migration) => /^[a-f0-9]{64}$/.test(migration.checksum)));
  assert.ok(migrations.every((migration) => !/^BEGIN;/i.test(migration.sql)));
  const healthRunIdempotency = migrations.find((migration) => migration.filename === '0012_health_snapshot_run_idempotency.sql');
  assert.match(healthRunIdempotency?.sql ?? '', /DROP INDEX health_snapshots_profile_revision_unique/i);
  assert.match(healthRunIdempotency?.sql ?? '', /analysis_run_id, profile_id, profile_version/i);
  const nullableFindingRisk = migrations.find((migration) => migration.filename === '0013_nullable_unassessed_finding_risk.sql');
  assert.match(nullableFindingRisk?.sql ?? '', /ALTER COLUMN current_risk DROP NOT NULL/i);
  const postgresQueueAndGraph = migrations.find((migration) => migration.filename === '0014_postgres_queue_and_code_graph.sql');
  const queueAndGraphSql = postgresQueueAndGraph?.sql ?? '';
  assert.match(queueAndGraphSql, /ADD COLUMN analysis_run_id uuid/i);
  assert.match(queueAndGraphSql, /CREATE TABLE data_flow_edges/i);
  assert.match(queueAndGraphSql, /FORCE ROW LEVEL SECURITY/i);
  assert.match(queueAndGraphSql, /analysis_jobs_ready_queue_idx/i);
  assert.match(queueAndGraphSql, /analysis_jobs_expired_lease_idx/i);
  assert.match(queueAndGraphSql, /session_user = 'bugzero_queue_worker'/i);
  assert.doesNotMatch(queueAndGraphSql, /app\.analysis_worker/i);
  assert.doesNotMatch(queueAndGraphSql, /\bDELETE\s+FROM\b|\bTRUNCATE\b|\bDROP\s+TABLE\b/i);
  const advisoryReviewErrors = migrations.find((migration) => migration.filename === '0015_advisory_review_errors.sql');
  assert.match(advisoryReviewErrors?.sql ?? '', /INSUFFICIENT_SOURCE/);
  assert.doesNotMatch(advisoryReviewErrors?.sql ?? '', /\bDELETE\s+FROM\b|\bTRUNCATE\b|\bDROP\s+TABLE\b/i);
  const foundation = migrations.find((migration) => migration.filename === '0001_bugzero_foundation.sql');
  assert.match(foundation?.sql ?? '', /UNIQUE \(organization_id, finding_id, analysis_run_id\)/i);
  const runScopedOccurrences = migrations.find((migration) => migration.filename === '0016_run_scoped_finding_occurrences.sql');
  assert.match(runScopedOccurrences?.sql ?? '', /DROP INDEX IF EXISTS finding_occurrences_replay_identity_unique/i);
  assert.doesNotMatch(runScopedOccurrences?.sql ?? '', /DROP CONSTRAINT|DROP INDEX (?!IF EXISTS finding_occurrences_replay_identity_unique)/i);
  const invitations = migrations.find((migration) => migration.filename === '0017_secure_organization_invitations.sql');
  const invitationSql = invitations?.sql ?? '';
  assert.match(invitationSql, /role IN \('DEVELOPER', 'SECURITY_REVIEWER', 'VIEWER'\)/i);
  assert.match(invitationSql, /token_hash char\(64\).*UNIQUE/i);
  assert.match(invitationSql, /organization_invitations_pending_email_unique/i);
  assert.match(invitationSql, /FORCE ROW LEVEL SECURITY/i);
  assert.match(invitationSql, /organization_id = nullif\(current_setting\('app\.organization_id'/i);
  assert.doesNotMatch(invitationSql, /\bDELETE\s+FROM\b|\bTRUNCATE\b|\bDROP\s+TABLE\b/i);
});
