import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { RepositoryCommit, RepositoryFileRecord, RepositoryRecord } from '@bugzero/database';
import { RepositorySourceProvider } from '../src/jobs/process-analysis-job.js';

const organizationId = '11111111-1111-4111-8111-111111111111';
const repositoryId = '22222222-2222-4222-8222-222222222222';
const commitId = '33333333-3333-4333-8333-333333333333';
const content = 'export const localSource = true;\n';
const digest = createHash('sha256').update(content).digest('hex');

const repository: RepositoryRecord = {
  id: repositoryId,
  organization_id: organizationId,
  provider: 'LOCAL',
  external_id: 'local-fixture',
  full_name: 'Local Fixture',
  default_branch: 'main',
  clone_url: 'local://local-fixture',
  created_at: new Date(0).toISOString(),
  updated_at: new Date(0).toISOString(),
};

const commit: RepositoryCommit = {
  id: commitId,
  organization_id: organizationId,
  repository_id: repositoryId,
  commit_sha: 'a'.repeat(40),
  parent_commit_sha: null,
  committed_at: null,
  indexed_at: null,
  created_at: new Date(0).toISOString(),
};

function makeFile(contentHash: string): RepositoryFileRecord {
  return {
    id: '44444444-4444-4444-8444-444444444444',
    organization_id: organizationId,
    repository_id: repositoryId,
    commit_id: commitId,
    path: 'src/index.ts',
    content_sha256: contentHash,
    size_bytes: Buffer.byteLength(content),
    language: 'TypeScript',
    object_key: null,
    source_content: content,
    created_at: new Date(0).toISOString(),
  };
}

test('local analysis source is read from persisted repository file content', async () => {
  const provider = new RepositorySourceProvider(undefined, {
    async listByCommit() {
      return [makeFile(digest)];
    },
  });

  assert.deepEqual(await provider.readCommit(repository, commit), [
    { path: 'src/index.ts', content },
  ]);
});

test('local analysis source rejects persisted content that fails integrity verification', async () => {
  const provider = new RepositorySourceProvider(undefined, {
    async listByCommit() {
      return [makeFile('0'.repeat(64))];
    },
  });

  await assert.rejects(provider.readCommit(repository, commit), /integrity verification/);
});
