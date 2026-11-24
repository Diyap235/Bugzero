import assert from 'node:assert/strict';
import test from 'node:test';

import { startApiServer } from '../src/server.js';

test('API startup rejects a missing database URL before listening', async () => {
  const previous = process.env.DATABASE_URL;
  try {
    delete process.env.DATABASE_URL;
    await assert.rejects(
      startApiServer({ async authenticate() { return null; } }),
      /DATABASE_URL must be configured with a Neon PostgreSQL connection URL/,
    );
  } finally {
    if (previous === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous;
  }
});
