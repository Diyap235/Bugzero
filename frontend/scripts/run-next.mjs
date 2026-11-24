import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const nextCli = require.resolve('next/dist/bin/next');
const requireFromNext = createRequire(nextCli);
const { loadEnvConfig } = requireFromNext('@next/env');

loadEnvConfig(resolve(process.cwd(), '..'), process.env.NODE_ENV !== 'production');

const child = spawn(process.execPath, [nextCli, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: process.env,
});

child.on('error', (error) => {
  console.error(`Failed to start Next.js (${error.name})`);
  process.exitCode = 1;
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exitCode = code ?? 1;
});
