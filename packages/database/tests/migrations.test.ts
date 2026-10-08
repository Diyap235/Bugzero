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
  ]);
  assert.ok(migrations.every((migration) => /^[a-f0-9]{64}$/.test(migration.checksum)));
  assert.ok(migrations.every((migration) => !/^BEGIN;/i.test(migration.sql)));
});
