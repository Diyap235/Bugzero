export interface RuntimeEnvironment {
  REDIS_URL?: string;
  [key: string]: string | undefined;
}

export function getRedisUrl(environment: RuntimeEnvironment = process.env): string {
  const redisUrl = environment.REDIS_URL?.trim();
  if (!redisUrl) {
    throw new Error('REDIS_URL must be configured for analysis queue access');
  }
  return redisUrl;
}

export const defaultAnalysisProfile = {
  id: 'default',
  version: '1',
  analyzers: [{ name: 'structural-quality-analyzer', type: 'STRUCTURAL' }],
  maxDepth: 3,
} as const;
