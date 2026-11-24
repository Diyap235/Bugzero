import test from 'node:test';
import assert from 'node:assert/strict';
import type { Pool } from 'pg';

import {
  FindingRepository,
  type CreateFindingOccurrenceInput,
  type FindingOccurrence,
} from '../src/repositories/findings.repository.js';

function createOccurrenceInput(analysisRunId: string): CreateFindingOccurrenceInput {
  return {
    organizationId: '11111111-1111-4111-8111-111111111111',
    findingId: '22222222-2222-4222-8222-222222222222',
    repositoryId: '33333333-3333-4333-8333-333333333333',
    commitId: '44444444-4444-4444-8444-444444444444',
    analysisRunId,
    ruleId: 'SECURITY.SQL_INJECTION',
    semanticTargetId: 'db.query',
    normalizedFingerprint: 'same-finding-at-same-location',
    observation: 'DETECTED',
    severity: 'HIGH',
    confidence: 'HIGH',
    evidenceStrength: 'HIGH',
    exploitability: 'HIGH',
    reachability: 'HIGH',
    technicalRisk: 80,
    resolution: 'EXACT',
    matchResult: 'SAME',
  };
}

function createRepository(): { repository: FindingRepository; occurrences: Map<string, FindingOccurrence> } {
  const occurrences = new Map<string, FindingOccurrence>();
  let sequence = 0;
  const pool = {
    async query(sql: string, values: unknown[] = []) {
      if (sql.includes('INSERT INTO finding_occurrences')) {
        assert.match(sql, /ON CONFLICT \(organization_id, finding_id, analysis_run_id\) DO NOTHING/i);
        const [organizationId, findingId, repositoryId, commitId, analysisRunId, ruleId, semanticTargetId,
          normalizedFingerprint, relationshipFingerprint, filePath, startLine, endLine, observation, severity,
          confidence, evidenceStrength, exploitability, reachability, technicalRisk, resolution, matchResult] = values;
        const key = `${organizationId}|${findingId}|${analysisRunId}`;
        if (occurrences.has(key)) return { rows: [] };
        const record: FindingOccurrence = {
          id: `occurrence-${++sequence}`,
          organization_id: String(organizationId),
          finding_id: String(findingId),
          repository_id: String(repositoryId),
          commit_id: String(commitId),
          analysis_run_id: String(analysisRunId),
          rule_id: String(ruleId),
          semantic_target_id: String(semanticTargetId),
          normalized_fingerprint: String(normalizedFingerprint),
          relationship_fingerprint: relationshipFingerprint === null ? null : String(relationshipFingerprint),
          file_path: filePath === null ? null : String(filePath),
          start_line: startLine === null ? null : Number(startLine),
          end_line: endLine === null ? null : Number(endLine),
          observation: observation as FindingOccurrence['observation'],
          severity: severity as FindingOccurrence['severity'],
          confidence: confidence as FindingOccurrence['confidence'],
          evidence_strength: evidenceStrength as FindingOccurrence['evidence_strength'],
          exploitability: exploitability as FindingOccurrence['exploitability'],
          reachability: reachability as FindingOccurrence['reachability'],
          technical_risk: Number(technicalRisk),
          resolution: resolution as FindingOccurrence['resolution'],
          match_result: matchResult as FindingOccurrence['match_result'],
          created_at: new Date(0).toISOString(),
        };
        occurrences.set(key, record);
        return { rows: [record] };
      }

      assert.match(sql, /WHERE organization_id = \$1 AND finding_id = \$2 AND analysis_run_id = \$3/i);
      const key = `${values[0]}|${values[1]}|${values[2]}`;
      const record = occurrences.get(key);
      return { rows: record ? [record] : [] };
    },
  } as unknown as Pool;

  return { repository: new FindingRepository(pool), occurrences };
}

test('finding occurrences are idempotent for concurrent retries of one analysis run', async () => {
  const { repository, occurrences } = createRepository();
  const input = createOccurrenceInput('55555555-5555-4555-8555-555555555555');

  const [first, concurrentRetry] = await Promise.all([
    repository.createOccurrenceIfAbsent(input),
    repository.createOccurrenceIfAbsent(input),
  ]);

  assert.equal(occurrences.size, 1);
  assert.equal(first.record.id, concurrentRetry.record.id);
  assert.deepEqual([first.created, concurrentRetry.created].sort(), [false, true]);
});

test('same-commit analyses in different runs receive distinct finding occurrences', async () => {
  const { repository, occurrences } = createRepository();
  const first = await repository.createOccurrenceIfAbsent(
    createOccurrenceInput('55555555-5555-4555-8555-555555555555'),
  );
  const repeatedRun = await repository.createOccurrenceIfAbsent(
    createOccurrenceInput('66666666-6666-4666-8666-666666666666'),
  );

  assert.equal(occurrences.size, 2);
  assert.notEqual(first.record.id, repeatedRun.record.id);
  assert.equal(first.record.commit_id, repeatedRun.record.commit_id);
  assert.notEqual(first.record.analysis_run_id, repeatedRun.record.analysis_run_id);
});

test('finding occurrence retry rejects a conflicting immutable payload', async () => {
  const { repository } = createRepository();
  const input = createOccurrenceInput('55555555-5555-4555-8555-555555555555');
  await repository.createOccurrenceIfAbsent(input);

  await assert.rejects(
    repository.createOccurrenceIfAbsent({ ...input, observation: 'NOT_DETECTED' }),
    /Finding occurrence identity conflict; immutable fields differ: observation/,
  );
});

test('batch occurrence lookup is tenant-scoped, deduplicates IDs, and skips empty inputs', async () => {
  const queries: { sql: string; values: unknown[] }[] = [];
  const pool = {
    async query(sql: string, values: unknown[] = []) {
      queries.push({ sql, values });
      return { rows: [] };
    },
  } as unknown as Pool;
  const repository = new FindingRepository(pool);
  const organizationId = '11111111-1111-4111-8111-111111111111';
  const findingId = '22222222-2222-4222-8222-222222222222';

  assert.deepEqual(await repository.getOccurrencesForFindings(organizationId, []), []);
  assert.equal(queries.length, 0);

  assert.deepEqual(await repository.getOccurrencesForFindings(
    organizationId,
    [findingId, findingId],
  ), []);
  assert.equal(queries.length, 1);
  assert.match(queries[0]?.sql ?? '', /organization_id = \$1 AND finding_id = ANY\(\$2::uuid\[\]\)/);
  assert.deepEqual(queries[0]?.values, [organizationId, [findingId]]);
});
