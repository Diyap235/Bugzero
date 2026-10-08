import assert from 'node:assert/strict';
import test from 'node:test';
import { createApiServer } from '../../src/server.js';

test('repository creation is exposed only through local ZIP ingestion', async () => {
  const app = createApiServer({
    async authenticate() {
      return {
        organizationId: '11111111-1111-4111-8111-111111111111',
        userId: '33333333-3333-4333-8333-333333333333',
      };
    },
    queue: { async enqueue() {} },
    members: {
      async getMembership() {
        return {
          id: 'member',
          organization_id: '11111111-1111-4111-8111-111111111111',
          user_id: '33333333-3333-4333-8333-333333333333',
          role: 'OWNER',
          created_at: '',
          updated_at: '',
        };
      },
    },
  });

  try {
    const response = await app.inject({
      method: 'POST',
      url: '/repositories',
      payload: { fullName: 'provider/repository' },
    });
    assert.equal(response.statusCode, 404);
  } finally {
    await app.close();
  }
});
