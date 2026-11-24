export interface RuntimeEnvironment {
  NVIDIA_API_KEY?: string;
  NVIDIA_MODEL?: string;
  [key: string]: string | undefined;
}

export interface NvidiaRuntimeConfig {
  apiKey: string | null;
  model: string;
}

export function getNvidiaRuntimeConfig(environment: RuntimeEnvironment = process.env): NvidiaRuntimeConfig {
  const apiKey = environment.NVIDIA_API_KEY?.trim() || null;
  const model = environment.NVIDIA_MODEL?.trim() || 'openai/gpt-oss-20b';
  if (model.length > 120 || /[\r\n]/.test(model)) {
    throw new Error('NVIDIA_MODEL must be a valid model identifier');
  }
  return { apiKey, model };
}

export const defaultAnalysisProfile = {
  id: 'default',
  version: '1',
  analyzers: [{ name: 'structural-quality-analyzer', type: 'STRUCTURAL' }],
  maxDepth: 3,
} as const;
