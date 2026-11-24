import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient, QueryResultRow } from 'pg';
import { AnalysisQueuePayloadSchema, UUID, type AnalysisQueuePayload } from '@bugzero/contracts';
import {
  analysisRepository,
  getQueueDatabasePool,
  type AnalysisRepository,
  withAnalysisJobLeaseContext,
  withOrganizationContext,
} from '@bugzero/database';

export type { AnalysisQueuePayload } from '@bugzero/contracts';

export interface AnalysisAttemptContext {
  attempt: number;
  maxAttempts: number;
}

export interface AnalysisQueueWorkerOptions {
  concurrency?: number;
  leaseDurationMs?: number;
  pollIntervalMs?: number;
  retryBaseDelayMs?: number;
  targetJobId?: string;
  targetOrganizationId?: string;
  finalizeFailedRun?: (organizationId: string, runId: string, reason: string) => Promise<void>;
}

interface ClaimedJob extends QueryResultRow {
  organization_id: string;
  id: string;
  run_id: string;
  attempt: number;
  max_attempts: number;
  lease_owner: string;
}

interface ExpiredJob extends QueryResultRow {
  organization_id: string;
  run_id: string;
  id: string;
}

interface LockedJob extends QueryResultRow {
  organization_id: string;
  id: string;
  run_id: string;
  status: string;
  attempt: number;
  max_attempts: number;
}

function errorMessage(error: unknown): string | null {
  if (error === undefined) return null;
  return error instanceof Error ? error.message : String(error);
}

class AnalysisLeaseError extends Error {
  constructor(message: string, readonly category: 'ownership_lost' | 'renewal_failed') {
    super(message);
    this.name = 'AnalysisLeaseError';
  }
}

function errorDetails(error: unknown): {
  errorName: string;
  errorMessage: string;
  errorStack?: string;
  errorCauses?: { errorName: string; errorMessage: string }[];
} {
  const rawMessage = errorMessage(error) ?? 'Unknown error';
  const redact = (value: string): string => value
    .replace(/(postgres(?:ql)?:\/\/[^:\s/@]+:)[^@\s]+@/gi, '$1[REDACTED]@')
    .replace(/\bBearer\s+\S+/gi, 'Bearer [REDACTED]')
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g, '[REDACTED]');
  const errorName = error instanceof Error ? error.name : 'UnknownError';
  const stack = error instanceof Error ? error.stack : undefined;
  const causes = error instanceof AggregateError
    ? [...error.errors].map((cause) => ({
      errorName: cause instanceof Error ? cause.name : 'UnknownError',
      errorMessage: redact(errorMessage(cause) ?? 'Unknown error'),
    }))
    : undefined;
  return {
    errorName,
    errorMessage: redact(rawMessage),
    ...(stack ? { errorStack: redact(stack) } : {}),
    ...(causes ? { errorCauses: causes } : {}),
  };
}

async function queueTransaction<T>(pool: Pool, operation: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      throw new AggregateError([error, rollbackError], 'Analysis queue transaction and rollback failed');
    }
    throw error;
  } finally {
    client.release();
  }
}

async function markRunFailed(organizationId: string, runId: string, reason: string): Promise<void> {
  await withOrganizationContext(organizationId, async () => {
    const run = await analysisRepository.getRun(organizationId, runId);
    if (!run) throw new Error(`Analysis run ${runId} was not found while finalizing its queue job`);
    if (run.status === 'COMPLETED' || run.status === 'PARTIAL' || run.status === 'FAILED') return;
    await analysisRepository.updateRunStatus(organizationId, runId, 'FAILED', {
      ...run.coverage,
      pipeline: { status: 'FAILED', error: reason },
    });
  });
}

export async function processAnalysisQueuePayload(
  payload: unknown,
  processor: (input: AnalysisQueuePayload, attempt: AnalysisAttemptContext, signal?: AbortSignal) => Promise<unknown>,
  attempt: AnalysisAttemptContext,
  signal?: AbortSignal,
): Promise<unknown> {
  const canonicalPayload = AnalysisQueuePayloadSchema.safeParse(payload);
  if (!canonicalPayload.success) {
    throw new Error('Analysis queue payload does not match the canonical worker input contract');
  }
  if (
    !Number.isSafeInteger(attempt.attempt)
    || !Number.isSafeInteger(attempt.maxAttempts)
    || attempt.attempt < 1
    || attempt.maxAttempts < attempt.attempt
  ) {
    throw new Error('Analysis queue attempt metadata is invalid');
  }
  return processor(canonicalPayload.data, attempt, signal);
}

export class PostgresAnalysisQueueWorker {
  private readonly pool: Pool;
  private readonly concurrency: number;
  private readonly leaseDurationMs: number;
  private readonly pollIntervalMs: number;
  private readonly retryBaseDelayMs: number;
  private readonly targetJobId: string | null;
  private readonly targetOrganizationId: string | null;
  private readonly finalizeFailedRun: (organizationId: string, runId: string, reason: string) => Promise<void>;
  private running = false;
  private stopping = false;
  private readonly active = new Set<Promise<void>>();

  constructor(
    private readonly processor: (
      payload: AnalysisQueuePayload,
      attempt: AnalysisAttemptContext,
      signal?: AbortSignal,
    ) => Promise<unknown>,
    options: AnalysisQueueWorkerOptions = {},
    pool: Pool = getQueueDatabasePool(),
    private readonly analysis: Pick<AnalysisRepository, 'getJob' | 'getRun'> = analysisRepository,
  ) {
    this.pool = pool;
    this.concurrency = options.concurrency ?? 2;
    this.leaseDurationMs = options.leaseDurationMs ?? 90_000;
    this.pollIntervalMs = options.pollIntervalMs ?? 1_000;
    this.retryBaseDelayMs = options.retryBaseDelayMs ?? 1_000;
    if ((options.targetJobId === undefined) !== (options.targetOrganizationId === undefined)) {
      throw new Error('Analysis queue single-job mode requires both a target job ID and organization ID');
    }
    if (options.targetJobId !== undefined && !UUID.safeParse(options.targetJobId).success) {
      throw new Error('Analysis queue target job ID must be a valid UUID');
    }
    if (options.targetOrganizationId !== undefined && !UUID.safeParse(options.targetOrganizationId).success) {
      throw new Error('Analysis queue target organization ID must be a valid UUID');
    }
    this.targetJobId = options.targetJobId?.toLowerCase() ?? null;
    this.targetOrganizationId = options.targetOrganizationId?.toLowerCase() ?? null;
    this.finalizeFailedRun = options.finalizeFailedRun ?? markRunFailed;
    if (!Number.isSafeInteger(this.concurrency) || this.concurrency < 1) {
      throw new Error('Analysis queue concurrency must be a positive integer');
    }
    for (const [name, value] of [
      ['lease duration', this.leaseDurationMs],
      ['poll interval', this.pollIntervalMs],
      ['retry base delay', this.retryBaseDelayMs],
    ] as const) {
      if (!Number.isSafeInteger(value) || value < 1) {
        throw new Error(`Analysis queue ${name} must be a positive integer`);
      }
    }
  }

  async run(): Promise<void> {
    if (this.running) throw new Error('Analysis queue worker is already running');
    const role = await this.pool.query<{ session_user: string; rolbypassrls: boolean }>(
      `SELECT session_user, rolbypassrls
       FROM pg_roles
       WHERE rolname = session_user`,
    );
    if (
      role.rows.length !== 1
      || role.rows[0].session_user !== 'bugzero_queue_worker'
      || role.rows[0].rolbypassrls
    ) {
      throw new Error('Queue worker must connect as the non-BYPASSRLS bugzero_queue_worker database role');
    }
    this.running = true;
    try {
      while (!this.stopping) {
        try {
          while (!this.stopping && this.active.size < this.concurrency) {
            const job = await this.claim();
            if (!job) {
              if (this.targetJobId) this.stopping = true;
              break;
            }
            const task = this.processClaim(job)
              .catch((error: unknown) => {
                console.error(JSON.stringify({
                  event: 'analysis.queue.processing_error',
                  jobId: job.id,
                  ...errorDetails(error),
                }));
              })
              .finally(() => this.active.delete(task));
            this.active.add(task);
            if (this.targetJobId) {
              this.stopping = true;
              break;
            }
          }
        } catch (error) {
          console.error(JSON.stringify({
            event: 'analysis.queue.poll_error',
            errorName: error instanceof Error ? error.name : 'UnknownError',
          }));
        }
        if (this.stopping) break;
        await this.wait(this.active.size > 0 ? Math.min(this.pollIntervalMs, 250) : this.pollIntervalMs);
      }
    } finally {
      await Promise.all(this.active);
      this.running = false;
    }
  }

  async close(): Promise<void> {
    this.stopping = true;
    while (this.running) await this.wait(10);
  }

  private async wait(durationMs: number): Promise<void> {
    if (durationMs === 0) return;
    await new Promise<void>((resolve) => setTimeout(resolve, durationMs));
  }

  private async claim(): Promise<ClaimedJob | null> {
    const result = await queueTransaction(this.pool, async (client) => {
      const expired = await client.query<ExpiredJob>(
        `UPDATE analysis_jobs
         SET status = 'DEAD_LETTER', finished_at = now(), lease_owner = NULL,
             lease_expires_at = NULL, last_error = 'Worker lease expired at the configured attempt limit'
         WHERE id IN (
           SELECT id FROM analysis_jobs
           WHERE status = 'RUNNING' AND lease_expires_at <= now() AND attempt >= max_attempts
             AND ($1::uuid IS NULL OR id = $1::uuid)
             AND ($2::uuid IS NULL OR organization_id = $2::uuid)
           ORDER BY lease_expires_at, id
           FOR UPDATE SKIP LOCKED
           LIMIT 100
         )
         RETURNING organization_id, run_id, id`,
        [this.targetJobId, this.targetOrganizationId],
      );
      if (expired.rows.length > 0) return { job: null, expired: expired.rows };

      const claimed = await client.query<ClaimedJob>(
        `WITH candidate AS (
           SELECT id
           FROM analysis_jobs
           WHERE attempt < max_attempts
             AND (lease_owner IS NULL OR lease_expires_at <= now())
             AND (
               (status IN ('QUEUED', 'RETRY') AND available_at <= now())
               OR (status = 'RUNNING' AND lease_expires_at <= now())
             )
               AND ($3::uuid IS NULL OR id = $3::uuid)
               AND ($4::uuid IS NULL OR organization_id = $4::uuid)
           ORDER BY available_at, created_at, id
           FOR UPDATE SKIP LOCKED
           LIMIT 1
         )
         UPDATE analysis_jobs AS job
         SET status = 'RUNNING', attempt = job.attempt + 1, started_at = COALESCE(job.started_at, now()),
             finished_at = NULL, lease_owner = $1, lease_expires_at = now() + ($2 * interval '1 millisecond'),
             last_error = NULL
         FROM candidate
         WHERE job.id = candidate.id
         RETURNING job.organization_id, job.id, job.run_id, job.attempt, job.max_attempts, job.lease_owner`,
        [randomUUID(), this.leaseDurationMs, this.targetJobId, this.targetOrganizationId],
      );
      const job = claimed.rows[0] ?? null;
      if (
        job
        && this.targetJobId !== null
        && (job.id !== this.targetJobId || job.organization_id !== this.targetOrganizationId)
      ) {
        throw new Error('Analysis queue returned a job outside the requested job and organization scope');
      }
      return { job, expired: expired.rows };
    });
    for (const expired of result.expired) {
      await this.finalizeDeadLetter(
        expired,
        'Worker lease expired at the configured attempt limit',
        'Worker lease expired at the configured attempt limit',
      );
      console.error(JSON.stringify({
        event: 'analysis.queue.dead_lettered',
        jobId: expired.id,
        reason: 'lease_expired_at_attempt_limit',
      }));
    }
    return result.job;
  }

  private async processClaim(job: ClaimedJob): Promise<void> {
    const controller = new AbortController();
    const renewal = this.maintainLease(job, controller);
    let processingError: unknown;
    let processingFailed = false;
    try {
      if (this.targetJobId !== null) await this.verifyClaimedJobRun(job);
      await withOrganizationContext(job.organization_id, () =>
        withAnalysisJobLeaseContext(job.organization_id, job.id, job.lease_owner, () =>
          processAnalysisQueuePayload(
            { organizationId: job.organization_id, jobId: job.id },
            this.processor,
            { attempt: job.attempt, maxAttempts: job.max_attempts },
            controller.signal,
          )));
    } catch (error) {
      processingFailed = true;
      processingError = error;
    } finally {
      controller.abort();
    }

    const renewalFailure = await renewal;
    if (renewalFailure) {
      const leaseError = renewalFailure.error;
      console.error(JSON.stringify({
        event: 'analysis.queue.lease_renewal_failed',
        jobId: job.id,
        organizationId: job.organization_id,
        attempt: job.attempt,
        leaseFailureCategory: renewalFailure.category,
        ...errorDetails(leaseError),
      }));
      if (processingError === leaseError) throw leaseError;
      if (processingFailed) throw new AggregateError(
        [processingError, leaseError],
        `Analysis job ${job.id} failed while its lease was lost`,
      );
      throw leaseError;
    }

    let completed: boolean;
    try {
      completed = await this.acknowledge(job, processingError);
    } catch (acknowledgementError) {
      if (processingFailed) throw new AggregateError(
        [processingError, acknowledgementError],
        `Analysis job ${job.id} failed and acknowledgement also failed`,
      );
      throw acknowledgementError;
    }
    if (!completed) {
      const leaseError = new AnalysisLeaseError(
        `Analysis job ${job.id} lease ownership was lost before acknowledgement`,
        'ownership_lost',
      );
      if (processingFailed) throw new AggregateError(
        [processingError, leaseError],
        `Analysis job ${job.id} failed after its lease was lost`,
      );
      throw leaseError;
    }
    if (processingFailed) throw processingError;
  }

  private async verifyClaimedJobRun(job: ClaimedJob): Promise<void> {
    if (
      this.targetJobId !== null
      && (job.id !== this.targetJobId || job.organization_id !== this.targetOrganizationId)
    ) {
      throw new Error('Claimed analysis job does not match the requested job and organization scope');
    }

    await withOrganizationContext(job.organization_id, async () => {
      const persistedJob = await this.analysis.getJob(job.organization_id, job.id);
      if (
        !persistedJob
        || persistedJob.id !== job.id
        || persistedJob.organization_id !== job.organization_id
        || persistedJob.run_id !== job.run_id
        || persistedJob.status !== 'RUNNING'
        || persistedJob.attempt !== job.attempt
      ) {
        throw new Error('Claimed analysis job does not match its persisted organization, run, or lease state');
      }

      const run = await this.analysis.getRun(job.organization_id, persistedJob.run_id);
      if (!run || run.id !== persistedJob.run_id || run.organization_id !== persistedJob.organization_id) {
        throw new Error('Claimed analysis job does not reference a run in its persisted organization');
      }
    });
  }

  private async maintainLease(
    job: ClaimedJob,
    controller: AbortController,
  ): Promise<{ error: unknown; category: AnalysisLeaseError['category'] } | null> {
    const { signal } = controller;
    const intervalMs = Math.max(1, Math.floor(this.leaseDurationMs / 3));
    let renewalCount = 0;
    while (!signal.aborted) {
      await this.waitForAbort(intervalMs, signal);
      if (signal.aborted) return null;
      try {
        const renewalStartedAt = Date.now();
        await this.renewLease(job);
        renewalCount += 1;
        console.info(JSON.stringify({
          event: 'analysis.queue.lease_renewed',
          jobId: job.id,
          organizationId: job.organization_id,
          attempt: job.attempt,
          renewalCount,
          durationMs: Date.now() - renewalStartedAt,
        }));
      } catch (error) {
        const category = error instanceof AnalysisLeaseError ? error.category : 'renewal_failed';
        const leaseError = error instanceof AnalysisLeaseError
          ? error
          : new AnalysisLeaseError(`Analysis job ${job.id} lease renewal failed`, category);
        (leaseError as Error & { cause?: unknown }).cause = error;
        controller.abort(leaseError);
        return { error: leaseError, category };
      }
    }
    return null;
  }

  private async waitForAbort(durationMs: number, signal: AbortSignal): Promise<void> {
    await new Promise<void>((resolve) => {
      if (signal.aborted) {
        resolve();
        return;
      }
      const finish = (): void => {
        clearTimeout(timer);
        signal.removeEventListener('abort', finish);
        resolve();
      };
      const timer = setTimeout(finish, durationMs);
      signal.addEventListener('abort', finish, { once: true });
    });
  }

  private async renewLease(job: ClaimedJob): Promise<void> {
    const result = await queueTransaction(this.pool, (client) => client.query(
      `UPDATE analysis_jobs
       SET lease_expires_at = now() + ($3 * interval '1 millisecond')
       WHERE organization_id = $1 AND id = $2 AND status = 'RUNNING'
         AND lease_owner = $4 AND lease_expires_at > now()`,
      [job.organization_id, job.id, this.leaseDurationMs, job.lease_owner],
    ));
    if (result.rowCount !== 1) {
      throw new AnalysisLeaseError(`Analysis job ${job.id} no longer belongs to this worker lease`, 'ownership_lost');
    }
  }

  private async acknowledge(job: ClaimedJob, processingError: unknown): Promise<boolean> {
    const delayMs = Math.min(this.retryBaseDelayMs * (2 ** Math.min(job.attempt - 1, 10)), 15 * 60_000);
    const result = await queueTransaction(this.pool, async (client) => {
      const locked = await client.query<LockedJob>(
        `SELECT organization_id, id, run_id, status, attempt, max_attempts
         FROM analysis_jobs
         WHERE organization_id = $1 AND id = $2 AND lease_owner = $3 AND lease_expires_at > now()
         FOR UPDATE`,
        [job.organization_id, job.id, job.lease_owner],
      );
      const current = locked.rows[0];
      if (!current) return { acknowledged: false, deadLetter: null };

      if (current.status === 'RETRY') {
        if (current.attempt >= current.max_attempts) {
          const updated = await client.query(
            `UPDATE analysis_jobs
             SET status = 'DEAD_LETTER', finished_at = now(), lease_owner = NULL,
                 lease_expires_at = NULL, last_error = COALESCE($4, last_error)
             WHERE organization_id = $1 AND id = $2 AND lease_owner = $3 AND lease_expires_at > now()`,
            [job.organization_id, job.id, job.lease_owner, errorMessage(processingError)],
          );
          return { acknowledged: updated.rowCount === 1, deadLetter: updated.rowCount === 1 ? current : null };
        }
        const updated = await client.query(
          `UPDATE analysis_jobs
           SET available_at = now() + ($4 * interval '1 millisecond'),
               lease_owner = NULL, lease_expires_at = NULL,
               last_error = COALESCE($5, last_error)
           WHERE organization_id = $1 AND id = $2 AND lease_owner = $3 AND lease_expires_at > now()`,
          [job.organization_id, job.id, job.lease_owner, delayMs, errorMessage(processingError)],
        );
        return { acknowledged: updated.rowCount === 1, deadLetter: null };
      }

      if (current.status === 'RUNNING') {
        const status = processingError === undefined
          ? 'COMPLETED'
          : current.attempt < current.max_attempts ? 'RETRY' : 'DEAD_LETTER';
        const updated = await client.query(
          `UPDATE analysis_jobs
           SET status = $4,
               available_at = CASE WHEN $4 = 'RETRY' THEN now() + ($5 * interval '1 millisecond') ELSE available_at END,
               finished_at = CASE WHEN $4 IN ('COMPLETED', 'DEAD_LETTER') THEN now() ELSE NULL END,
               lease_owner = NULL, lease_expires_at = NULL,
               last_error = CASE WHEN $4 = 'COMPLETED' THEN NULL
                                 ELSE COALESCE($6, 'Processor returned without finalizing job status') END
           WHERE organization_id = $1 AND id = $2 AND lease_owner = $3 AND lease_expires_at > now()`,
          [
            job.organization_id,
            job.id,
            job.lease_owner,
            status,
            delayMs,
            errorMessage(processingError),
          ],
        );
        return { acknowledged: updated.rowCount === 1, deadLetter: status === 'DEAD_LETTER' ? current : null };
      }

      const updated = await client.query(
        `UPDATE analysis_jobs
         SET lease_owner = NULL, lease_expires_at = NULL,
             last_error = COALESCE($4, last_error)
        WHERE organization_id = $1 AND id = $2 AND lease_owner = $3 AND lease_expires_at > now()`,
        [job.organization_id, job.id, job.lease_owner, errorMessage(processingError)],
      );
      return { acknowledged: updated.rowCount === 1, deadLetter: null };
    });
    if (result.deadLetter) {
      await this.finalizeDeadLetter(
        result.deadLetter,
        'Analysis job exhausted its retry attempts',
        'Analysis job exhausted its retry attempts',
      );
    }
    return result.acknowledged;
  }

  private async finalizeDeadLetter(job: ExpiredJob, reason: string, retryReason: string): Promise<void> {
    try {
      await this.finalizeFailedRun(job.organization_id, job.run_id, reason);
    } catch (error) {
      console.error(JSON.stringify({
        event: 'analysis.queue.dead_letter_finalize_failed',
        jobId: job.id,
        organizationId: job.organization_id,
        ...errorDetails(error),
      }));
      try {
        const requeued = await queueTransaction(this.pool, (client) => client.query(
          `UPDATE analysis_jobs
           SET status = 'RUNNING', finished_at = NULL, lease_owner = NULL,
               lease_expires_at = now(), last_error = COALESCE(last_error, $3)
           WHERE organization_id = $1 AND id = $2 AND status = 'DEAD_LETTER'`,
          [job.organization_id, job.id, retryReason],
        ));
        if (requeued.rowCount !== 1) {
          throw new Error(`Dead-letter job ${job.id} could not be returned for finalization retry`);
        }
      } catch (retryError) {
        throw new AggregateError([error, retryError], `Dead-letter job ${job.id} finalization and retry scheduling failed`);
      }
      throw error;
    }
  }
}

export function createAnalysisQueueWorker(
  processor: (payload: AnalysisQueuePayload, attempt: AnalysisAttemptContext, signal?: AbortSignal) => Promise<unknown>,
  options: AnalysisQueueWorkerOptions = {},
  pool?: Pool,
  analysis?: Pick<AnalysisRepository, 'getJob' | 'getRun'>,
): PostgresAnalysisQueueWorker {
  return new PostgresAnalysisQueueWorker(processor, options, pool, analysis);
}
