import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { generateKeyPairSync } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

test('API startup failures report a safe error category without message or stack', async () => {
  const { publicKey } = generateKeyPairSync('ed25519');
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/start.ts'], {
    cwd: fileURLToPath(new URL('../', import.meta.url)),
    env: {
      ...process.env,
      DATABASE_URL: 'postgresql://test:test@db.neon.tech/test',
      AUTH_PUBLIC_KEY: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      HOST: '127.0.0.1',
      PORT: '70000',
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => { stderr += chunk; });
  const [exitCode] = await once(child, 'close') as [number | null];

  assert.notEqual(exitCode, 0);
  assert.match(stderr, /"event":"bugzero\.api\.startup_failed"/);
  assert.match(stderr, /"errorName":"(?:RangeError|Error)"/);
  assert.doesNotMatch(stderr, /errorMessage|errorStack|70000|RangeError:/);
});
