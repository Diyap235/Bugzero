import assert from 'node:assert/strict';
import test from 'node:test';
import type { Pool } from 'pg';

import { CommitRepository } from '../src/repositories/commits.repository.js';

test('batch commit lookup is scoped to the organization and repository', async () => {
  const queries: { sql: string; values: unknown[] }[] = [];
  const pool = {
    async query(sql: string, values: unknown[] = []) {
      queries.push({ sql, values });
      return { rows: [] };
    },
  } as unknown as Pool;
  const repository = new CommitRepository(pool);
  const organizationId = '11111111-1111-4111-8111-111111111111';
  const repositoryId = '22222222-2222-4222-8222-222222222222';
  const commitId = '33333333-3333-4333-8333-333333333333';

  assert.deepEqual(await repository.getByIds(organizationId, repositoryId, []), []);
  assert.equal(queries.length, 0);

  assert.deepEqual(await repository.getByIds(organizationId, repositoryId, [commitId, commitId]), []);
  assert.equal(queries.length, 1);
  assert.match(queries[0]?.sql ?? '', /organization_id = \$1 AND repository_id = \$2 AND id = ANY\(\$3::uuid\[\]\)/);
  assert.deepEqual(queries[0]?.values, [organizationId, repositoryId, [commitId]]);
});
