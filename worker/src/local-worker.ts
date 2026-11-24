import { Client } from 'pg';
import {
  requireQueueWorkerLockDatabaseUrl,
} from '@bugzero/database';

import { analysisJobProcessor } from './jobs/process-analysis-job.js';
import { createAnalysisQueueWorker, type PostgresAnalysisQueueWorker } from './jobs/analysis-queue.js';

const WORKER_LOCK_KEYS: [number, number] = [0x42555A5A, 0x4C4F434C];
const INITIAL_RETRY_DELAY_MS = 1_000;
const MAX_RETRY_DELAY_MS = 30_000;

export interface AnalysisWorkerLock {
  lost: Promise<Error>;
  release(): Promise<void>;
}

export interface WorkerLockClient {
  connect(): Promise<void>;
  query(
    sql: string,
    values?: readonly unknown[],
  ): Promise<{ rows: Array<Record<string, unknown>> }>;
  end(): Promise<void>;
  onError(listener: (error: Error) => void): void;
}

export interface AnalysisWorkerLockOptions {
  queueDatabaseUrl?: string;
  lockDatabaseUrl?: string;
  createClient?: (connectionString: string) => WorkerLockClient;
}

export interface LocalAnalysisWorkerRuntime {
  acquireLock(): Promise<AnalysisWorkerLock | null>;
  createWorker(): Pick<PostgresAnalysisQueueWorker, 'run' | 'close'>;
}

export interface LocalAnalysisWorkerHandle {
  stop(): Promise<void>;
}

function failureDetails(error: unknown): { errorName: string; errorCode?: string } {
  const errorName = error instanceof Error ? error.name : 'UnknownError';
  const errorCode = typeof error === 'object' && error !== null && 'code' in error
    ? error.code
    : undefined;
  return {
    errorName,
    ...(typeof errorCode === 'string' && /^[A-Z0-9_]{3,16}$/.test(errorCode) ? { errorCode } : {}),
  };
}

function createPostgresLockClient(connectionString: string): WorkerLockClient {
  const client = new Client({
    connectionString,
    connectionTimeoutMillis: 5_000,
  });
  return {
    connect: async () => { await client.connect(); },
    query: (sql, values) => client.query<Record<string, unknown>>(sql, values ? [...values] : undefined),
    end: async () => { await client.end(); },
    onError: (listener) => { client.on('error', listener); },
  };
}

export async function acquireAnalysisWorkerLock(
  options: AnalysisWorkerLockOptions = {},
): Promise<AnalysisWorkerLock | null> {
  const connectionString = requireQueueWorkerLockDatabaseUrl(
    options.queueDatabaseUrl,
    options.lockDatabaseUrl,
  );
  const client = (options.createClient ?? createPostgresLockClient)(connectionString);
  let connectionError: Error | null = null;
  let acquired = false;
  let closing = false;
  let closePromise: Promise<void> | undefined;
  let releasePromise: Promise<void> | undefined;
  let resolveLost!: (error: Error) => void;
  const lost = new Promise<Error>((resolve) => { resolveLost = resolve; });
  const closeClient = (): Promise<void> => {
    closePromise ??= client.end();
    return closePromise;
  };

  client.onError((error) => {
    connectionError = error;
    if (acquired && !closing) resolveLost(error);
  });

  try {
    await client.connect();
    const role = await client.query(
      `SELECT session_user, rolbypassrls
       FROM pg_roles
       WHERE rolname = session_user`,
    );
    const roleRow = role.rows[0];
    if (
      role.rows.length !== 1
      || roleRow?.session_user !== 'bugzero_queue_worker'
      || roleRow?.rolbypassrls !== false
    ) {
      throw new Error('Queue worker must connect as the non-BYPASSRLS bugzero_queue_worker database role');
    }

    const lockResult = await client.query(
      'SELECT pg_try_advisory_lock($1, $2) AS acquired',
      WORKER_LOCK_KEYS,
    );
    if (lockResult.rows.length !== 1) {
      throw new Error('Could not verify PostgreSQL advisory lock acquisition');
    }
    if (lockResult.rows[0].acquired !== true) {
      await closeClient();
      return null;
    }
    acquired = true;
    if (connectionError) resolveLost(connectionError);

    return {
      lost,
      release(): Promise<void> {
        if (releasePromise) return releasePromise;
        closing = true;
        releasePromise = (async () => {
          let releaseError: unknown;
          try {
            if (!connectionError) {
              const result = await client.query(
                'SELECT pg_advisory_unlock($1, $2) AS unlocked',
                WORKER_LOCK_KEYS,
              );
              if (result.rows[0]?.unlocked !== true) {
                throw new Error('PostgreSQL advisory lock was not held by its owning connection');
              }
            }
          } catch (error) {
            releaseError = error;
          }

          try {
            await closeClient();
          } catch (closeError) {
            if (releaseError) {
              throw new AggregateError(
                [releaseError, closeError],
                'PostgreSQL advisory lock release and connection close both failed',
              );
            }
            throw closeError;
          }
          if (releaseError) throw releaseError;
        })();
        return releasePromise;
      },
    };
  } catch (error) {
    try {
      await closeClient();
    } catch (closeError) {
      throw new AggregateError(
        [error, closeError],
        'PostgreSQL advisory lock acquisition failed and its connection could not be closed',
      );
    }
    throw error;
  }
}

const defaultRuntime: LocalAnalysisWorkerRuntime = {
  acquireLock: acquireAnalysisWorkerLock,
  createWorker: () => createAnalysisQueueWorker(
    (payload, attempt, signal) => analysisJobProcessor.process(payload, attempt, signal),
  ),
};

export class LocalAnalysisWorkerSupervisor {
  private readonly stopController = new AbortController();
  private worker: Pick<PostgresAnalysisQueueWorker, 'run' | 'close'> | null = null;
  private workerClose: Promise<void> | null = null;
  private loop: Promise<void> | null = null;
  private handle: LocalAnalysisWorkerHandle | null = null;
  private stopping = false;

  constructor(
    private readonly runtime: LocalAnalysisWorkerRuntime = defaultRuntime,
    private readonly initialRetryDelayMs = INITIAL_RETRY_DELAY_MS,
    private readonly maxRetryDelayMs = MAX_RETRY_DELAY_MS,
  ) {
    if (!Number.isSafeInteger(initialRetryDelayMs) || initialRetryDelayMs < 1
      || !Number.isSafeInteger(maxRetryDelayMs) || maxRetryDelayMs < initialRetryDelayMs) {
      throw new Error('Local worker retry delays must be positive safe integers');
    }
  }

  start(): LocalAnalysisWorkerHandle {
    if (this.handle) return this.handle;
    this.handle = { stop: () => this.stop() };
    this.loop = this.supervise();
    return this.handle;
  }

  async stop(): Promise<void> {
    if (this.stopping) {
      await this.loop;
      return;
    }
    this.stopping = true;
    this.stopController.abort();
    try {
      if (this.worker) await this.closeWorker(this.worker);
    } catch (error) {
      console.error(JSON.stringify({
        event: 'analysis.local_worker.shutdown_failed',
        ...failureDetails(error),
      }));
    }
    await this.loop;
  }

  private async supervise(): Promise<void> {
    let retryDelayMs = this.initialRetryDelayMs;
    while (!this.stopping) {
      let lock: AnalysisWorkerLock | null = null;
      try {
        lock = await this.runtime.acquireLock();
        if (this.stopping) break;
        if (!lock) {
          console.info(JSON.stringify({ event: 'analysis.local_worker.already_running' }));
        } else {
          const worker = this.runtime.createWorker();
          this.worker = worker;
          this.workerClose = null;
          console.info(JSON.stringify({ event: 'analysis.local_worker.started' }));
          const workerRun = worker.run();
          let lockLost = false;
          try {
            const lockLostMonitor = lock?.lost.then(async (error) => {
              if (this.stopping) return;
              lockLost = true;
              console.error(JSON.stringify({
                event: 'analysis.local_worker.lock_connection_lost',
                ...failureDetails(error),
              }));
              await this.closeWorker(worker);
            });
            await (lockLostMonitor
              ? Promise.race([workerRun, lockLostMonitor])
              : workerRun);
            if (!this.stopping && !lockLost) {
              console.error(JSON.stringify({ event: 'analysis.local_worker.exited_unexpectedly' }));
            }
          } catch (error) {
            if (!this.stopping && !lockLost) {
              console.error(JSON.stringify({
                event: 'analysis.local_worker.crashed',
                ...failureDetails(error),
              }));
            }
          } finally {
            try {
              await this.closeWorker(worker);
            } catch (error) {
              if (!this.stopping) {
                console.error(JSON.stringify({
                  event: 'analysis.local_worker.worker_close_failed',
                  ...failureDetails(error),
                }));
              }
            }
            await workerRun.catch(() => undefined);
            this.worker = null;
            this.workerClose = null;
          }
        }
      } catch (error) {
        if (!this.stopping) {
          console.error(JSON.stringify({
            event: 'analysis.local_worker.start_failed',
            ...failureDetails(error),
          }));
        }
      } finally {
        if (lock) {
          try {
            await lock.release();
          } catch (error) {
            if (!this.stopping) {
              console.error(JSON.stringify({
                event: 'analysis.local_worker.lock_release_failed',
                ...failureDetails(error),
              }));
            }
          }
        }
      }

      if (!this.stopping) {
        await this.wait(retryDelayMs);
        retryDelayMs = Math.min(retryDelayMs * 2, this.maxRetryDelayMs);
      }
    }
  }

  private closeWorker(worker: Pick<PostgresAnalysisQueueWorker, 'run' | 'close'>): Promise<void> {
    this.workerClose ??= worker.close();
    return this.workerClose;
  }

  private async wait(durationMs: number): Promise<void> {
    if (this.stopController.signal.aborted) return;
    await new Promise<void>((resolve) => {
      const finish = (): void => {
        clearTimeout(timer);
        this.stopController.signal.removeEventListener('abort', finish);
        resolve();
      };
      const timer = setTimeout(finish, durationMs);
      this.stopController.signal.addEventListener('abort', finish, { once: true });
    });
  }
}

let activeSupervisor: LocalAnalysisWorkerSupervisor | null = null;
let activeHandle: LocalAnalysisWorkerHandle | null = null;

export function startLocalAnalysisWorker(): LocalAnalysisWorkerHandle {
  if (activeHandle) return activeHandle;
  const supervisor = new LocalAnalysisWorkerSupervisor();
  const supervisorHandle = supervisor.start();
  const handle: LocalAnalysisWorkerHandle = {
    async stop(): Promise<void> {
      await supervisorHandle.stop();
      if (activeSupervisor === supervisor) {
        activeSupervisor = null;
        activeHandle = null;
      }
    },
  };
  activeSupervisor = supervisor;
  activeHandle = handle;
  return handle;
}
