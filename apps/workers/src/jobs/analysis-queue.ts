import { Queue, Worker, type ConnectionOptions, type Job, type WorkerOptions } from 'bullmq';
import { AnalysisQueuePayloadSchema, type AnalysisQueuePayload } from '@bugzero/contracts';
import { withOrganizationContext } from '@bugzero/database';

export type { AnalysisQueuePayload } from '@bugzero/contracts';
export const analysisQueueName = 'bugzero-analysis-jobs';

export interface AnalysisAttemptContext {
  attempt: number;
  maxAttempts: number;
}

export function createAnalysisQueue(connection: ConnectionOptions): Queue<AnalysisQueuePayload> {
  return new Queue<AnalysisQueuePayload>(analysisQueueName, { connection });
}

export async function enqueueAnalysisJob(
  queue: Queue<AnalysisQueuePayload>,
  payload: AnalysisQueuePayload,
): Promise<Job<AnalysisQueuePayload>> {
  const canonicalPayload = AnalysisQueuePayloadSchema.parse(payload);
  return queue.add('quality-analysis', canonicalPayload, {
    jobId: canonicalPayload.jobId,
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
    removeOnComplete: 1000,
    removeOnFail: false,
  });
}

export async function processAnalysisQueuePayload(
  payload: unknown,
  processor: (input: AnalysisQueuePayload, attempt: AnalysisAttemptContext) => Promise<unknown>,
  attempt: AnalysisAttemptContext = { attempt: 1, maxAttempts: 1 },
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
  return processor(canonicalPayload.data, attempt);
}

export function createAnalysisQueueWorker(
  connection: WorkerOptions['connection'],
  processor: (payload: AnalysisQueuePayload, attempt: AnalysisAttemptContext) => Promise<unknown>,
): Worker<AnalysisQueuePayload> {
  return new Worker<AnalysisQueuePayload>(
    analysisQueueName,
    async (job) => withOrganizationContext(job.data.organizationId, async () => {
      const maxAttempts = typeof job.opts.attempts === 'number' ? job.opts.attempts : 1;
      return processAnalysisQueuePayload(job.data, processor, {
        attempt: job.attemptsMade + 1,
        maxAttempts,
      });
    }),
    { connection, concurrency: 2 },
  );
}
