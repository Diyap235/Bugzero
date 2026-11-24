import { authenticate } from './auth/default-adapter.js';
import { startApiServer } from './server.js';

async function main(): Promise<void> {
  const startLocalWorker = process.env.NODE_ENV === 'production'
    ? undefined
    : async () => {
      const { startLocalAnalysisWorker } = await import('@bugzero/workers/local-worker');
      return startLocalAnalysisWorker();
    };
  const server = await startApiServer({ authenticate, startLocalWorker });
  const shutdown = (): void => {
    void server.close().catch((error: unknown) => {
      process.exitCode = 1;
      console.error(JSON.stringify({
        event: 'bugzero.api.shutdown_failed',
        errorName: error instanceof Error ? error.name : 'UnknownError',
      }));
    });
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

void main().catch((error: unknown) => {
  const errorName = error instanceof Error ? error.name : 'UnknownError';
  console.error(JSON.stringify({
    event: 'bugzero.api.startup_failed',
    errorName,
  }));
  process.exitCode = 1;
});
