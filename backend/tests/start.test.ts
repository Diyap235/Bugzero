import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { startApiServer } from '../src/server.js';

test('the executable API wires the JWT verifier and starts a local worker outside production', async () => {
  const source = await readFile(new URL('../src/start.ts', import.meta.url), 'utf8');

  assert.match(source, /import \{ authenticate \} from '\.\/auth\/default-adapter\.js';/);
  assert.match(source, /process\.env\.NODE_ENV === 'production'/);
  assert.match(source, /import\('@bugzero\/workers\/local-worker'\)/);
  assert.match(source, /startApiServer\(\{ authenticate, startLocalWorker \}\)/);
  assert.doesNotMatch(source, /AUTH_ADAPTER_MODULE|pathToFileURL/);
});

test('API startup starts the configured local worker and stops it on server close', async () => {
  const previousDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = 'postgresql://worker-test@ep-test.neon.tech/bugzero';
  let starts = 0;
  let stops = 0;
  try {
    const server = await startApiServer({
      authenticate: async () => null,
      logger: false,
      startLocalWorker: async () => {
        starts += 1;
        return { stop: async () => { stops += 1; } };
      },
    }, 0);

    assert.equal(starts, 1);
    await server.close();
    assert.equal(stops, 1);
  } finally {
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
  }
});

test('API remains available when worker startup is skipped and the lock URL is unset', async () => {
  const previousDatabaseUrl = process.env.DATABASE_URL;
  const previousLockUrl = process.env.DATABASE_QUEUE_LOCK_URL;
  process.env.DATABASE_URL = 'postgresql://worker-test@ep-test.neon.tech/bugzero';
  delete process.env.DATABASE_QUEUE_LOCK_URL;
  try {
    const server = await startApiServer({
      authenticate: async () => null,
      logger: false,
    }, 0);

    assert.equal(server.server.listening, true);
    await server.close();
  } finally {
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    if (previousLockUrl === undefined) delete process.env.DATABASE_QUEUE_LOCK_URL;
    else process.env.DATABASE_QUEUE_LOCK_URL = previousLockUrl;
  }
});
