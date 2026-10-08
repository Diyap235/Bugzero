export interface RuntimeEnvironment {
  REDIS_URL?: string;
  GROQ_API_KEY?: string;
  GROQ_MODEL?: string;
  [key: string]: string | undefined;
}

export function getRedisUrl(environment: RuntimeEnvironment = process.env): string {
  const redisUrl = environment.REDIS_URL?.trim();
  if (!redisUrl) {
    throw new Error('REDIS_URL must be configured for analysis queue access');
  }
  return redisUrl;
}

export interface GroqRuntimeConfig {
  apiKey: string | null;
  model: string;
}

export function getGroqRuntimeConfig(environment: RuntimeEnvironment = process.env): GroqRuntimeConfig {
  const apiKey = environment.GROQ_API_KEY?.trim() || null;
  const model = environment.GROQ_MODEL?.trim() || 'llama-3.3-70b-versatile';
  if (model.length > 120 || /[\r\n]/.test(model)) {
    throw new Error('GROQ_MODEL must be a valid model identifier');
  }
  return { apiKey, model };
}

export const defaultAnalysisProfile = {
  id: 'default',
  version: '1',
  analyzers: [{ name: 'structural-quality-analyzer', type: 'STRUCTURAL' }],
  maxDepth: 3,
} as const;
