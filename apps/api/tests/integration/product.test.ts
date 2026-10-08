import test from 'node:test';
import assert from 'node:assert/strict';
import type { ReportRecord, RepositoryRecord } from '@bugzero/database';
import { createApiServer } from '../../src/server.js';

const organizationId = '11111111-1111-4111-8111-111111111111';
const repositoryId = '22222222-2222-4222-8222-222222222222';
const userId = '33333333-3333-4333-8333-333333333333';

const repository: RepositoryRecord = {
  id: repositoryId,
  organization_id: organizationId,
  provider: 'GITHUB',
  external_id: 'repo-1',
  full_name: 'example/repository',
  default_branch: 'main',
  clone_url: 'https://github.com/example/repository.git',
  created_at: new Date(0).toISOString(),
  updated_at: new Date(0).toISOString(),
};

const report: ReportRecord = {
  id: '44444444-4444-4444-8444-444444444444',
  organization_id: organizationId,
  repository_id: repositoryId,
  analysis_run_id: '55555555-5555-4555-8555-555555555555',
  created_by_user_id: userId,
  format: 'JSON',
  object_key: 'internal/report.json',
  metadata: { title: 'Analysis summary' },
  created_at: new Date(0).toISOString(),
};

test('GET repository reports returns the typed tenant-scoped report summary', async () => {
  const app = createApiServer({
    async authenticate() {
      return { organizationId, userId };
    },
    queue: { async enqueue() {} },
    product: {
      members: {
        async getMembership() {
          return {
            id: 'member',
            organization_id: organizationId,
            user_id: userId,
            role: 'VIEWER',
            created_at: '',
            updated_at: '',
          };
        },
      },
      repositories: {
        async createWithCommit() {
          throw new Error('Repository registration is not part of this reports test');
        },
        async getById(requestedOrganizationId, requestedRepositoryId) {
          return requestedOrganizationId === organizationId && requestedRepositoryId === repositoryId
            ? repository
            : null;
        },
        async listByOrganization() {
          return [repository];
        },
      },
      reports: {
        async listByRepository(requestedOrganizationId, requestedRepositoryId) {
          assert.equal(requestedOrganizationId, organizationId);
          assert.equal(requestedRepositoryId, repositoryId);
          return [report];
        },
      },
    },
  });

  try {
    const response = await app.inject({ method: 'GET', url: `/repositories/${repositoryId}/reports` });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), {
      reports: [{
        id: report.id,
        organizationId,
        repositoryId,
        analysisRunId: report.analysis_run_id,
        createdByUserId: userId,
        format: 'JSON',
        metadata: { title: 'Analysis summary' },
        createdAt: new Date(0).toISOString(),
      }],
    });
    assert.equal(response.body.includes(report.object_key ?? ''), false);
  } finally {
    await app.close();
  }
});

test('unhandled API failures return a safe structured response', async () => {
  const app = createApiServer({
    async authenticate() {
      return null;
    },
    queue: { async enqueue() {} },
  });
  app.get('/test/internal-error', async () => {
    throw new Error('database password and query text');
  });

  try {
    const response = await app.inject({ method: 'GET', url: '/test/internal-error' });
    assert.equal(response.statusCode, 500);
    assert.deepEqual(response.json(), {
      error: 'Internal server error',
      code: 'INTERNAL_ERROR',
    });
    assert.equal(response.body.includes('database password'), false);
  } finally {
    await app.close();
  }
});
