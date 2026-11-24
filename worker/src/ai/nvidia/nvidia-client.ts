import { AIInvestigationResultSchema } from '@bugzero/contracts';
import { getNvidiaRuntimeConfig } from '@bugzero/config';
import type { AIInvestigationErrorCode } from '@bugzero/database';

import { AIRepositoryReviewOutcomeSchema } from './nvidia-schemas.js';
import {
  findingInvestigationSystemPrompt,
  NVIDIA_REPOSITORY_REVIEW_PROMPT_VERSION,
  repositoryReviewSystemPrompt,
} from './nvidia-prompts.js';
import type {
  AIInvestigationContext,
  AIInvestigationOutcome,
  AIInvestigator,
  AIRepositoryReviewContext,
  AIRepositoryReviewOutcome,
} from '../investigation-types.js';

const CHAT_COMPLETIONS_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';
const MAX_FINDING_CONTEXT_CHARACTERS = 20_000;
const MAX_REPOSITORY_CONTEXT_CHARACTERS = 48_000;
const MAX_COMPLETION_TOKENS = 3_000;
const MAX_RESPONSE_CHARACTERS = 100_000;
const REQUEST_TIMEOUT_MS = 60_000;
const MAX_ATTEMPTS = 2;

interface CompletionResponse {
  choices?: Array<{ message?: { content?: string | null } }>;
}

interface CompletionRequest {
  model: string;
  messages: Array<{ role: 'system' | 'user'; content: string }>;
  temperature: number;
  max_tokens: number;
  response_format: { type: 'json_object' };
  stream: false;
}

export interface NvidiaCompletionTransport {
  create(input: CompletionRequest): Promise<CompletionResponse>;
}

export interface NvidiaInvestigatorOptions {
  environment?: Record<string, string | undefined>;
  explicitOptIn?: boolean;
  fetchImpl?: typeof fetch;
  client?: NvidiaCompletionTransport;
}

class CompletionFailure extends Error {
  constructor(
    readonly code: AIInvestigationErrorCode,
    readonly providerStatus?: number,
    readonly attempts = 1,
  ) {
    super(code);
  }
}

function parseContent(content: string): unknown {
  try {
    return JSON.parse(content) as unknown;
  } catch {
    throw new CompletionFailure('INVALID_RESPONSE');
  }
}

async function readBoundedResponse(response: Response): Promise<string> {
  if (!response.body) throw new CompletionFailure('INVALID_RESPONSE');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_CHARACTERS) {
        await reader.cancel();
        throw new CompletionFailure('INVALID_RESPONSE');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks).toString('utf8');
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && /abort|timeout/i.test(`${error.name} ${error.message}`);
}

function referencedFiles(context: AIRepositoryReviewContext): Map<string, { kind: 'SOURCE' | 'DEPENDENCY_MANIFEST'; lineCount: number }> {
  return new Map(context.files.map((file) => [
    file.filePath,
    { kind: file.kind, lineCount: file.source.split(/\r\n|\r|\n/).length },
  ]));
}

function validReference(
  reference: { filePath: string; line: number },
  files: Map<string, { kind: 'SOURCE' | 'DEPENDENCY_MANIFEST'; lineCount: number }>,
  requiresManifest = false,
): boolean {
  const file = files.get(reference.filePath);
  return Boolean(file)
    && (!requiresManifest || file?.kind === 'DEPENDENCY_MANIFEST')
    && Number.isSafeInteger(reference.line)
    && reference.line >= 1
    && reference.line <= (file?.lineCount ?? 0);
}

function sanitizeReview(
  context: AIRepositoryReviewContext,
  result: ReturnType<typeof AIRepositoryReviewOutcomeSchema.parse>,
) {
  const files = referencedFiles(context);
  const dimensions = Object.fromEntries(
    Object.entries(result.dimensions).map(([name, dimension]) => {
      const evidence = dimension.evidence.filter((reference) =>
        validReference(reference, files, name === 'DEPENDENCIES'));
      const hasEvidence = evidence.length > 0;
      return [name, {
        ...dimension,
        score: dimension.score !== null && hasEvidence && dimension.confidence !== null
          ? dimension.score
          : null,
        confidence: dimension.score !== null && hasEvidence ? dimension.confidence : null,
        evidence,
      }];
    }),
  ) as ReturnType<typeof AIRepositoryReviewOutcomeSchema.parse>['dimensions'];
  const findings = result.findings.filter((finding) => {
    const file = files.get(finding.filePath);
    return validReference({ filePath: finding.filePath, line: finding.startLine }, files, finding.dimension === 'DEPENDENCIES')
      && finding.endLine >= finding.startLine
      && finding.endLine <= (file?.lineCount ?? 0);
  });
  return { dimensions, findings };
}

export class NvidiaInvestigator implements AIInvestigator {
  readonly provider = 'NVIDIA' as const;
  readonly promptVersion = NVIDIA_REPOSITORY_REVIEW_PROMPT_VERSION;
  readonly enabled: boolean;
  readonly availability: 'ENABLED' | 'MISSING_CONFIGURATION' | 'INVALID_CONFIGURATION';
  readonly model: string;
  private readonly apiKey: string | null;
  private readonly fetchImpl: typeof fetch;
  private readonly client: NvidiaCompletionTransport | null;
  private readonly configurationError: boolean;

  constructor(options: NvidiaInvestigatorOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.client = options.client ?? null;
    const environment = options.environment ?? process.env;
    const explicitOptIn = options.explicitOptIn === true
      || environment.BUGZERO_ENABLE_EXTERNAL_AI?.trim().toLowerCase() === 'true';
    if (!explicitOptIn) {
      this.apiKey = null;
      this.model = 'disabled';
      this.configurationError = false;
      this.enabled = false;
      this.availability = 'MISSING_CONFIGURATION';
      return;
    }
    try {
      const config = getNvidiaRuntimeConfig(environment);
      this.apiKey = config.apiKey;
      this.model = config.model;
      this.configurationError = false;
    } catch {
      this.apiKey = null;
      this.model = 'unconfigured';
      this.configurationError = true;
    }
    this.enabled = !this.configurationError && Boolean(this.apiKey || this.client);
    this.availability = this.configurationError
      ? 'INVALID_CONFIGURATION'
      : this.enabled ? 'ENABLED' : 'MISSING_CONFIGURATION';
  }

  async investigate(context: AIInvestigationContext, signal?: AbortSignal): Promise<AIInvestigationOutcome> {
    if (this.configurationError) return { status: 'FAILED', result: null, errorCode: 'INVALID_CONFIGURATION' };
    if (!this.apiKey && !this.client) return { status: 'UNAVAILABLE', result: null, errorCode: 'MISSING_CONFIGURATION' };
    if (JSON.stringify(context).length > MAX_FINDING_CONTEXT_CHARACTERS) {
      return { status: 'FAILED', result: null, errorCode: 'CONTEXT_TOO_LARGE' };
    }
    try {
      const content = await this.complete(
        findingInvestigationSystemPrompt,
        `<BUGZERO_EVIDENCE>\n${JSON.stringify(context)}\n</BUGZERO_EVIDENCE>`,
        1_200,
        signal,
      );
      const parsed = AIInvestigationResultSchema.safeParse(parseContent(content.content));
      if (!parsed.success) return { status: 'FAILED', result: null, errorCode: 'INVALID_RESPONSE' };
      const supportsExplanation = context.analysisStatus === 'COMPLETED'
        && context.evidence.authority === 'AUTHORITATIVE'
        && context.evidence.sufficiency === 'SUFFICIENT'
        && context.evidence.completeness === 'COMPLETE';
      return {
        status: 'COMPLETED',
        result: supportsExplanation ? parsed.data : { ...parsed.data, reasoningStatus: 'INSUFFICIENT_EVIDENCE' },
        errorCode: null,
      };
    } catch (error) {
      return { status: 'FAILED', result: null, errorCode: this.errorCode(error) };
    }
  }

  async reviewRepository(
    context: AIRepositoryReviewContext,
    signal?: AbortSignal,
  ): Promise<AIRepositoryReviewOutcome> {
    if (this.configurationError) return { status: 'FAILED', result: null, errorCode: 'INVALID_CONFIGURATION' };
    if (!this.apiKey && !this.client) return { status: 'UNAVAILABLE', result: null, errorCode: 'MISSING_CONFIGURATION' };
    if (context.files.length === 0) {
      return { status: 'FAILED', result: null, errorCode: 'INSUFFICIENT_SOURCE' };
    }
    if (JSON.stringify(context).length > MAX_REPOSITORY_CONTEXT_CHARACTERS) {
      return { status: 'FAILED', result: null, errorCode: 'CONTEXT_TOO_LARGE' };
    }
    try {
      const content = await this.complete(
        repositoryReviewSystemPrompt,
        `<BUGZERO_REPOSITORY>\n${JSON.stringify(context)}\n</BUGZERO_REPOSITORY>`,
        MAX_COMPLETION_TOKENS,
        signal,
      );
      const parsed = AIRepositoryReviewOutcomeSchema.safeParse(parseContent(content.content));
      if (!parsed.success) {
        return { status: 'FAILED', result: null, errorCode: 'INVALID_RESPONSE', attempts: content.attempts };
      }
      return {
        status: 'COMPLETED',
        result: sanitizeReview(context, parsed.data),
        errorCode: null,
        attempts: content.attempts,
      };
    } catch (error) {
      return {
        status: 'FAILED',
        result: null,
        errorCode: this.errorCode(error),
        ...(error instanceof CompletionFailure && error.providerStatus !== undefined
          ? { providerStatus: error.providerStatus }
          : {}),
        ...(error instanceof CompletionFailure ? { attempts: error.attempts } : {}),
      };
    }
  }

  private async complete(
    system: string,
    user: string,
    maxTokens: number,
    signal?: AbortSignal,
  ): Promise<{ content: string; attempts: number }> {
    if (!this.apiKey && !this.client) throw new CompletionFailure('MISSING_CONFIGURATION');
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      try {
        const request: CompletionRequest = {
          model: this.model,
          messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
          temperature: 0,
          max_tokens: maxTokens,
          response_format: { type: 'json_object' },
          stream: false,
        };
        if (this.client) {
          const payload = await this.client.create(request);
          const content = payload.choices?.[0]?.message?.content;
          if (typeof content !== 'string') throw new CompletionFailure('INVALID_RESPONSE');
          return { content, attempts: attempt };
        }
        const requestSignal = signal
          ? AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)])
          : AbortSignal.timeout(REQUEST_TIMEOUT_MS);
        const response = await this.fetchImpl(CHAT_COMPLETIONS_URL, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.apiKey ?? ''}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(request),
          signal: requestSignal,
        });
        if (!response.ok) {
          const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
          if (retryable && attempt < MAX_ATTEMPTS) {
            await new Promise((resolve) => setTimeout(resolve, 200 * attempt));
            continue;
          }
          throw new CompletionFailure(
            response.status === 429 ? 'RATE_LIMITED'
              : response.status === 408 ? 'TIMEOUT' : 'PROVIDER_ERROR',
            response.status,
            attempt,
          );
        }
        const body = await readBoundedResponse(response);
        const payload = JSON.parse(body) as CompletionResponse;
        const content = payload.choices?.[0]?.message?.content;
        if (typeof content !== 'string') throw new CompletionFailure('INVALID_RESPONSE');
        return { content, attempts: attempt };
      } catch (error) {
        if (signal?.aborted) throw new CompletionFailure('TIMEOUT', undefined, attempt);
        const status = typeof error === 'object' && error !== null && 'status' in error
          && typeof error.status === 'number' ? error.status : null;
        if (status === 429) throw new CompletionFailure('RATE_LIMITED', undefined, attempt);
        if (status === 408 || isAbort(error)) throw new CompletionFailure('TIMEOUT', undefined, attempt);
        if (error instanceof CompletionFailure) {
          if (error.attempts === attempt) throw error;
          throw new CompletionFailure(error.code, error.providerStatus, attempt);
        }
        if (attempt === MAX_ATTEMPTS) throw new CompletionFailure('PROVIDER_ERROR', undefined, attempt);
        await new Promise((resolve) => setTimeout(resolve, 200 * attempt));
      }
    }
    throw new CompletionFailure('PROVIDER_ERROR', undefined, MAX_ATTEMPTS);
  }

  private errorCode(error: unknown): AIInvestigationErrorCode {
    return error instanceof CompletionFailure ? error.code : 'PROVIDER_ERROR';
  }
}

export function createNvidiaInvestigator(options?: NvidiaInvestigatorOptions): NvidiaInvestigator {
  return new NvidiaInvestigator(options);
}

export function selectNvidiaInvestigatorForRepository(
  provider: 'GITHUB' | 'LOCAL',
  configured: AIInvestigator,
): AIInvestigator {
  return provider === 'LOCAL'
    ? new NvidiaInvestigator({ environment: {} })
    : configured;
}
