import assert from 'node:assert/strict';
import test from 'node:test';
import type { RepositoryRecord } from '@bugzero/database';
import { createApiServer } from '../../src/server.js';

const organizationId = '11111111-1111-4111-8111-111111111111';
const userId = '33333333-3333-4333-8333-333333333333';
const repository: RepositoryRecord = {
  id: '22222222-2222-4222-8222-222222222222',
  organization_id: organizationId,
  provider: 'GITHUB',
  external_id: '9001',
  full_name: 'acme/service',
  default_branch: 'main',
  clone_url: 'https://github.com/acme/service.git',
  created_at: new Date(0).toISOString(),
  updated_at: new Date(0).toISOString(),
};
const commit = {
  id: '44444444-4444-4444-8444-444444444444',
  organization_id: organizationId,
  repository_id: repository.id,
  commit_sha: 'a'.repeat(40),
  parent_commit_sha: null,
  committed_at: null,
  indexed_at: new Date(0).toISOString(),
  created_at: new Date(0).toISOString(),
};

function createApp(role: 'OWNER' | 'VIEWER' = 'OWNER') {
  let providerCalls = 0;
  let persisted = false;
  const app = createApiServer({
    async authenticate() { return { organizationId, userId }; },
    queue: { async enqueue() {} },
    product: {
      members: {
        async getMembership() {
          return {
            id: 'member',
            organization_id: organizationId,
            user_id: userId,
            role,
            created_at: '',
            updated_at: '',
          };
        },
      },
      repositories: {
        async getById() { return null; },
        async listByOrganization() { return []; },
        async createWithCommit(input) {
          persisted = true;
          assert.equal(input.organizationId, organizationId);
          assert.equal(input.provider, 'GITHUB');
          assert.equal(input.fullName, 'acme/service');
          assert.equal(input.commitSha, commit.commit_sha);
          return { repository, commit };
        },
      },
      github: {
        async getRepositoryByFullName(fullName) {
          providerCalls += 1;
          assert.equal(fullName, 'acme/service');
          return {
            id: '9001',
            fullName: 'acme/service',
            defaultBranch: 'main',
            cloneUrl: repository.clone_url,
            provider: 'GITHUB',
          };
        },
        async getCommit() {
          return {
            sha: commit.commit_sha,
            parentSha: null,
            committedAt: null,
            authorName: null,
            authorEmail: null,
            message: null,
          };
        },
      },
    },
  });
  return { app, get providerCalls() { return providerCalls; }, get persisted() { return persisted; } };
}

test('repository onboarding validates GitHub metadata and persists an analysis-ready commit', async () => {
  const context = createApp();
  try {
    const response = await context.app.inject({
      method: 'POST',
      url: '/repositories',
      payload: { fullName: 'acme/service' },
    });
    assert.equal(response.statusCode, 201);
    assert.deepEqual(response.json().latestCommit, {
      id: commit.id,
      organizationId,
      repositoryId: repository.id,
      commitSha: commit.commit_sha,
      parentCommitSha: null,
      createdAt: commit.created_at,
      indexedAt: commit.indexed_at,
    });
    assert.equal(context.providerCalls, 1);
    assert.equal(context.persisted, true);
  } finally {
    await context.app.close();
  }
});

test('repository onboarding rejects unsafe names and viewer-role writes', async () => {
  const invalid = createApp();
  try {
    const response = await invalid.app.inject({
      method: 'POST',
      url: '/repositories',
      payload: { fullName: '../attacker/repo' },
    });
    assert.equal(response.statusCode, 400);
    assert.equal(invalid.providerCalls, 0);
    assert.equal(invalid.persisted, false);
  } finally {
    await invalid.app.close();
  }

  const viewer = createApp('VIEWER');
  try {
    const response = await viewer.app.inject({
      method: 'POST',
      url: '/repositories',
      payload: { fullName: 'acme/service' },
    });
    assert.equal(response.statusCode, 403);
    assert.equal(viewer.providerCalls, 0);
    assert.equal(viewer.persisted, false);
  } finally {
    await viewer.app.close();
  }
});
