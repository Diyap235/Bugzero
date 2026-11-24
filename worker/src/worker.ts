import { pathToFileURL } from 'node:url';

import {
  closeQueueDatabasePool,
  requireNeonDatabaseUrl,
  requireQueueWorkerDatabaseUrl,
  requireQueueWorkerLockDatabaseUrl,
} from '@bugzero/database';
import { UUID } from '@bugzero/contracts';
import { analysisJobProcessor } from './jobs/process-analysis-job.js';
import { createAnalysisQueueWorker } from './jobs/analysis-queue.js';
import { acquireAnalysisWorkerLock, type AnalysisWorkerLock } from './local-worker.js';
import { closeMLSignalInference, warmUpMLSignalInference } from './ml/ml-signal-adapter.js';

export const workerName = 'bugzero-worker';

export interface WorkerTarget {
  jobId: string;
  organizationId: string;
}

export interface WorkerStartupFailureDetails {
  errorName: string;
  failureCategory: 'queue_role_validation' | 'database_error' | 'startup_error';
  databaseErrorCode?: string;
}

export function getWorkerStartupFailureDetails(error: unknown): WorkerStartupFailureDetails {
  const errorName = error instanceof Error ? error.name : 'UnknownError';
  const message = error instanceof Error ? error.message : '';
  if (message === 'Queue worker must connect as the non-BYPASSRLS bugzero_queue_worker database role') {
    return { errorName, failureCategory: 'queue_role_validation' };
  }

  const code = typeof error === 'object' && error !== null && 'code' in error
    ? error.code
    : undefined;
  if (typeof code === 'string' && /^[A-Z0-9_]{3,16}$/.test(code)) {
    return { errorName, failureCategory: 'database_error', databaseErrorCode: code };
  }
  return { errorName, failureCategory: 'startup_error' };
}

export * from './jobs/ingest-repository.js';
export * from './jobs/process-analysis-job.js';
export * from './jobs/analysis-queue.js';
export * from './analyzers/analyzer-orchestrator.js';
export * from './providers/github-provider.js';
export * from './intelligence/repository-intelligence-builder.js';
export * from './intelligence/impact-analysis.js';

export function parseWorkerArguments(args: string[]): WorkerTarget | undefined {
  if (args.length === 0) return undefined;
  if (
    args.length !== 4
    || args[0] !== '--job-id'
    || args[2] !== '--organization-id'
  ) {
    throw new Error('Usage: worker [--job-id <uuid> --organization-id <uuid>]');
  }
  const parsedJobId = UUID.safeParse(args[1]);
  if (!parsedJobId.success) throw new Error('Worker --job-id must be a valid UUID');
  const parsedOrganizationId = UUID.safeParse(args[3]);
  if (!parsedOrganizationId.success) throw new Error('Worker --organization-id must be a valid UUID');
  return {
    jobId: parsedJobId.data.toLowerCase(),
    organizationId: parsedOrganizationId.data.toLowerCase(),
  };
}

export function startWorker(target?: WorkerTarget): void {
  if (
    target !== undefined
    && (!UUID.safeParse(target.jobId).success || !UUID.safeParse(target.organizationId).success)
  ) {
    throw new Error('Worker target job ID and organization ID must be valid UUIDs');
  }
  requireNeonDatabaseUrl('DATABASE_URL');
  requireQueueWorkerDatabaseUrl();
  requireQueueWorkerLockDatabaseUrl();
  const worker = createAnalysisQueueWorker(
    (payload, attempt, signal) => analysisJobProcessor.process(payload, attempt, signal),
    { targetJobId: target?.jobId, targetOrganizationId: target?.organizationId },
  );
  let stopping = false;
  let workerLock: AnalysisWorkerLock | null = null;
  let shutdownPromise: Promise<void> | undefined;
  const shutdown = async (): Promise<void> => {
    if (!shutdownPromise) {
      stopping = true;
      shutdownPromise = worker.close()
        .then(closeMLSignalInference)
        .finally(async () => {
          try {
            await closeQueueDatabasePool();
          } finally {
            await workerLock?.release();
            workerLock = null;
          }
        });
    }
    await shutdownPromise;
  };
  const startup = async (): Promise<void> => {
    workerLock = await acquireAnalysisWorkerLock();
    if (!workerLock) {
      console.info(JSON.stringify({ event: 'analysis.worker.already_running' }));
      await shutdown();
      return;
    }
    if (stopping) {
      await workerLock.release();
      workerLock = null;
      return;
    }
    const warmupStartedAt = Date.now();
    try {
      await warmUpMLSignalInference();
      console.info(JSON.stringify({
        event: 'analysis.ml.warmed',
        durationMs: Date.now() - warmupStartedAt,
      }));
    } catch (error) {
      console.error(JSON.stringify({
        event: 'analysis.ml.warmup_failed',
        durationMs: Date.now() - warmupStartedAt,
        errorName: error instanceof Error ? error.name : 'UnknownError',
      }));
    }
    if (stopping) return;
    const lockLost = workerLock.lost.then(() => {
      throw new Error('Analysis worker lock connection lost');
    });
    await Promise.race([worker.run(), lockLost]);
    if (target) await shutdown();
  };
  const handleShutdown = (): void => {
    void shutdown().catch((error: unknown) => {
      process.exitCode = 1;
      console.error(JSON.stringify({
        event: 'analysis.worker.shutdown_failed',
        errorName: error instanceof Error ? error.name : 'UnknownError',
      }));
    });
  };
  process.once('SIGINT', handleShutdown);
  process.once('SIGTERM', handleShutdown);
  void startup().catch(async (error: unknown) => {
    process.exitCode = 1;
    console.error(JSON.stringify({
      event: 'analysis.worker.stopped_unexpectedly',
      ...getWorkerStartupFailureDetails(error),
    }));
    try {
      await shutdown();
    } catch (shutdownError) {
      console.error(JSON.stringify({
        event: 'analysis.worker.shutdown_failed',
        errorName: shutdownError instanceof Error ? shutdownError.name : 'UnknownError',
      }));
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startWorker(parseWorkerArguments(process.argv.slice(2)));
}
