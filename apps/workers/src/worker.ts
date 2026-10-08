import { pathToFileURL } from 'node:url';

import { Redis } from 'ioredis';
import { getRedisUrl } from '@bugzero/config';

import { analysisJobProcessor } from './jobs/process-analysis-job.js';
import { createAnalysisQueueWorker } from './jobs/analysis-queue.js';

export const workerName = 'bugzero-worker';

export * from './jobs/ingest-repository.js';
export * from './jobs/process-analysis-job.js';
export * from './jobs/analysis-queue.js';
export * from './analyzers/analyzer-orchestrator.js';
export * from './providers/github-provider.js';
export * from './intelligence/repository-intelligence-builder.js';
export * from './intelligence/impact-analysis.js';

export function startWorker(): void {
  const connection = new Redis(getRedisUrl(), {
    maxRetriesPerRequest: null,
  });
  const worker = createAnalysisQueueWorker(connection, (payload, attempt) => analysisJobProcessor.process(payload, attempt));
  worker.on('failed', (job, error) => {
    console.error(JSON.stringify({
      event: 'analysis.queue.failed',
      queueJobId: job?.id ?? null,
      errorName: error.name,
    }));
  });
  worker.on('error', (error) => {
    console.error(JSON.stringify({ event: 'analysis.worker.error', errorName: error.name }));
  });

  const shutdown = async (): Promise<void> => {
    await worker.close();
    await connection.quit();
  };
  process.once('SIGINT', () => { void shutdown(); });
  process.once('SIGTERM', () => { void shutdown(); });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startWorker();
}
