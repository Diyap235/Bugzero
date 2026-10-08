import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { FastifyRequest } from 'fastify';

import { startApiServer } from './server.js';
import type { AuthenticatedAnalysisPrincipal } from './modules/analysis/routes.js';

interface AuthenticationAdapterModule {
  authenticate?: (request: FastifyRequest) => Promise<AuthenticatedAnalysisPrincipal | null>;
}

async function main(): Promise<void> {
  const adapterPath = process.env.AUTH_ADAPTER_MODULE;
  const adapter = adapterPath
    ? await import(pathToFileURL(resolve(adapterPath)).href) as AuthenticationAdapterModule
    : await import('./auth/default-adapter.js') as AuthenticationAdapterModule;
  if (typeof adapter.authenticate !== 'function') {
    throw new Error('The configured authentication adapter must export authenticate(request)');
  }
  await startApiServer({ authenticate: adapter.authenticate });
}

void main().catch((error: unknown) => {
  const errorName = error instanceof Error ? error.name : 'UnknownError';
  const errorMessage = error instanceof Error ? error.message : String(error);
  const errorStack = error instanceof Error ? error.stack : undefined;
  console.error(`BugZero API startup failed (${errorName})`);
  console.error(`Message: ${errorMessage}`);
  console.error(`Stack: ${errorStack ?? 'Unavailable'}`);
  process.exitCode = 1;
});
