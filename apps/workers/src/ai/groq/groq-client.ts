import Groq from 'groq-sdk';

import { AIInvestigationResultSchema } from '@bugzero/contracts';
import { getGroqRuntimeConfig } from '@bugzero/config';

import { groqInvestigationSystemPrompt, GROQ_INVESTIGATION_PROMPT_VERSION } from './groq-prompts.js';
import type { AIInvestigationContext, AIInvestigationOutcome, AIInvestigator } from './groq-types.js';

const MAX_CONTEXT_CHARACTERS = 20_000;
const MAX_COMPLETION_TOKENS = 1_200;
const REQUEST_TIMEOUT_MS = 12_000;

interface GroqMessage {
  role: 'system' | 'user';
  content: string;
}

export interface GroqCompletionTransport {
  create(input: {
    model: string;
    messages: GroqMessage[];
    temperature: number;
    max_tokens: number;
    response_format: { type: 'json_object' };
  }): Promise<{ choices?: Array<{ message?: { content?: string | null } }> }>;
}

export interface GroqInvestigatorOptions {
  environment?: Record<string, string | undefined>;
  client?: GroqCompletionTransport;
}

export function enforceEvidenceBoundaries(
  context: AIInvestigationContext,
  result: ReturnType<typeof AIInvestigationResultSchema.parse>,
): ReturnType<typeof AIInvestigationResultSchema.parse> {
  const evidenceSupportsExplanation = context.analysisStatus === 'COMPLETED'
    && context.evidence.authority === 'AUTHORITATIVE'
    && context.evidence.sufficiency === 'SUFFICIENT'
    && context.evidence.completeness === 'COMPLETE';
  if (!evidenceSupportsExplanation) {
    return { ...result, reasoningStatus: 'INSUFFICIENT_EVIDENCE' };
  }
  return result;
}

export class GroqInvestigator implements AIInvestigator {
  readonly provider = 'GROQ' as const;
  readonly promptVersion = GROQ_INVESTIGATION_PROMPT_VERSION;
  readonly enabled: boolean;
  readonly availability: 'ENABLED' | 'MISSING_CONFIGURATION' | 'INVALID_CONFIGURATION';
  readonly model: string;
  private readonly client: GroqCompletionTransport | null;
  private readonly configurationError: 'INVALID_CONFIGURATION' | null;

  constructor(options: GroqInvestigatorOptions = {}) {
    let config: ReturnType<typeof getGroqRuntimeConfig>;
    try {
      config = getGroqRuntimeConfig(options.environment);
      this.configurationError = null;
    } catch {
      this.configurationError = 'INVALID_CONFIGURATION';
      this.availability = 'INVALID_CONFIGURATION';
      this.model = 'unconfigured';
      this.client = null;
      this.enabled = false;
      return;
    }
    this.model = config.model;
    this.enabled = Boolean(options.client || config.apiKey);
    this.availability = this.enabled ? 'ENABLED' : 'MISSING_CONFIGURATION';
    if (options.client) {
      this.client = options.client;
    } else if (config.apiKey) {
      this.client = new Groq({
        apiKey: config.apiKey,
        maxRetries: 1,
        timeout: REQUEST_TIMEOUT_MS,
      }).chat.completions;
    } else {
      this.client = null;
    }
  }

  async investigate(context: AIInvestigationContext): Promise<AIInvestigationOutcome> {
    if (this.configurationError) {
      return { status: 'FAILED', result: null, errorCode: this.configurationError };
    }
    if (!this.client) {
      return { status: 'UNAVAILABLE', result: null, errorCode: 'MISSING_CONFIGURATION' };
    }

    const serializedContext = JSON.stringify(context);
    if (serializedContext.length > MAX_CONTEXT_CHARACTERS) {
      return { status: 'FAILED', result: null, errorCode: 'CONTEXT_TOO_LARGE' };
    }

    try {
      const completion = await this.client.create({
        model: this.model,
        messages: [
          { role: 'system', content: groqInvestigationSystemPrompt },
          { role: 'user', content: `<BUGZERO_EVIDENCE>\n${serializedContext}\n</BUGZERO_EVIDENCE>` },
        ],
        temperature: 0,
        max_tokens: MAX_COMPLETION_TOKENS,
        response_format: { type: 'json_object' },
      });
      const content = completion.choices?.[0]?.message?.content;
      if (typeof content !== 'string') {
        return { status: 'FAILED', result: null, errorCode: 'INVALID_RESPONSE' };
      }
      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(content);
      } catch {
        return { status: 'FAILED', result: null, errorCode: 'INVALID_RESPONSE' };
      }
      const parsed = AIInvestigationResultSchema.safeParse(parsedJson);
      if (!parsed.success) {
        return { status: 'FAILED', result: null, errorCode: 'INVALID_RESPONSE' };
      }
      return {
        status: 'COMPLETED',
        result: enforceEvidenceBoundaries(context, parsed.data),
        errorCode: null,
      };
    } catch (error) {
      const details = error as { name?: unknown; status?: unknown };
      const name = typeof details.name === 'string' ? details.name : '';
      const status = typeof details.status === 'number' ? details.status : null;
      if (status === 429) return { status: 'FAILED', result: null, errorCode: 'RATE_LIMITED' };
      if (/timeout|abort/i.test(name)) return { status: 'FAILED', result: null, errorCode: 'TIMEOUT' };
      return { status: 'FAILED', result: null, errorCode: 'PROVIDER_ERROR' };
    }
  }
}

export function createGroqInvestigator(options?: GroqInvestigatorOptions): GroqInvestigator {
  return new GroqInvestigator(options);
}
