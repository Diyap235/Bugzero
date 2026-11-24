interface CacheEntry {
  expiresAt: number;
  value?: unknown;
  pending?: Promise<unknown>;
}

const entries = new Map<string, CacheEntry>();
const analysisRepositories = new Map<string, string>();
let activeScope: string | null | undefined;
const sessionInvalidationListeners = new Set<() => void>();

function prepareScope(scope: string | null): void {
  if (activeScope === scope) return;
  entries.clear();
  analysisRepositories.clear();
  activeScope = scope;
}

function entryKey(scope: string, key: string): string {
  return `${scope}\u0000${key}`;
}

export function getCachedData<T>(scope: string, key: string): T | undefined {
  prepareScope(scope);
  const entry = entries.get(entryKey(scope, key));
  if (!entry || entry.value === undefined || entry.expiresAt <= Date.now()) return undefined;
  return entry.value as T;
}

export function getStaleCachedData<T>(scope: string, key: string): T | undefined {
  prepareScope(scope);
  return entries.get(entryKey(scope, key))?.value as T | undefined;
}

export function setCachedData<T>(scope: string, key: string, value: T): void {
  prepareScope(scope);
  entries.set(entryKey(scope, key), { value, expiresAt: Number.POSITIVE_INFINITY });
}

export function registerAnalysisRepository(scope: string, analysisRunId: string, repositoryId: string): void {
  prepareScope(scope);
  analysisRepositories.set(analysisRunId, repositoryId);
}

export function getAnalysisRepository(scope: string, analysisRunId: string): string | undefined {
  prepareScope(scope);
  return analysisRepositories.get(analysisRunId);
}

export function loadCachedData<T>(
  scope: string,
  key: string,
  load: () => Promise<T>,
  ttlMs = 10_000,
): Promise<T> {
  prepareScope(scope);
  const cacheKey = entryKey(scope, key);
  const existing = entries.get(cacheKey);
  if (existing && (existing.pending || existing.expiresAt > Date.now())) {
    return (existing.pending ?? Promise.resolve(existing.value)) as Promise<T>;
  }

  const entry: CacheEntry = { expiresAt: Number.POSITIVE_INFINITY };
  const pending = load().then((value) => {
    entry.value = value;
    entry.expiresAt = Date.now() + ttlMs;
    delete entry.pending;
    return value;
  }).catch((error: unknown) => {
    if (entries.get(cacheKey) === entry) entries.delete(cacheKey);
    throw error;
  });
  entry.pending = pending;
  entries.set(cacheKey, entry);
  return pending;
}

export function invalidateCachedData(
  scope: string,
  shouldInvalidate?: (key: string) => boolean,
): void {
  prepareScope(scope);
  for (const key of entries.keys()) {
    const separator = key.indexOf('\u0000');
    const entryScope = key.slice(0, separator);
    const cacheKey = key.slice(separator + 1);
    if (entryScope === scope && (!shouldInvalidate || shouldInvalidate(cacheKey))) {
      entries.delete(key);
    }
  }
}

export function invalidatePageData(scope: string, pageKey: string): void {
  const page = `page:${pageKey}`;
  const apiMatches = (key: string): boolean => {
    if (!key.startsWith("api:")) return false;
    const path = key.slice("api:".length);
    if (pageKey === "history-repository-list") return path === "/repositories";
    if (pageKey === "dashboard" || pageKey === "repositories") {
      return path === "/repositories" || path.startsWith("/repositories/");
    }
    if (pageKey === "findings") {
      return path === "/repositories"
        || path.startsWith("/repositories/") && path.endsWith("/findings")
        || path.startsWith("/findings/");
    }
    if (pageKey === "health") {
      return path === "/repositories"
        || path.startsWith("/repositories/") && path.endsWith("/health");
    }
    if (pageKey === "history") {
      return path === "/repositories"
        || path.startsWith("/repositories/") && path.endsWith("/history");
    }
    if (pageKey.startsWith("history:")) {
      const repositoryId = pageKey.slice("history:".length);
      if (repositoryId === "ALL") {
        return path === "/repositories"
          || path.startsWith("/repositories/") && path.endsWith("/history");
      }
      return path === `/repositories/${encodeURIComponent(repositoryId)}/history`;
    }
    if (pageKey.startsWith("reports-history:")) {
      const repositoryId = pageKey.slice("reports-history:".length);
      return path === `/repositories/${encodeURIComponent(repositoryId)}/history`;
    }
    if (pageKey === "reports") {
      return path === "/repositories"
        || path.startsWith("/repositories/") && path.endsWith("/reports");
    }
    const [kind, id] = pageKey.split(":");
    if (!id) return false;
    const encodedId = encodeURIComponent(id);
    return kind === "repository"
      ? path === `/repositories/${encodedId}`
      : kind === "finding" && path === `/findings/${encodedId}`;
  };
  invalidateCachedData(scope, (key) =>
    key === page
    || (pageKey === "history" || pageKey === "history:ALL") && key.startsWith("page:history:")
    || pageKey === "reports" && key.startsWith("page:reports-history:")
    || apiMatches(key));
}

export function clearCachedData(): void {
  entries.clear();
  analysisRepositories.clear();
  activeScope = undefined;
  for (const listener of sessionInvalidationListeners) listener();
}

export function subscribeToCacheInvalidation(listener: () => void): () => void {
  sessionInvalidationListeners.add(listener);
  return () => sessionInvalidationListeners.delete(listener);
}

export function invalidateRepositoryData(scope: string, repositoryId: string): void {
  const repositoryPath = `/repositories/${encodeURIComponent(repositoryId)}`;
  const affectedPages = new Set([
    'page:dashboard',
    'page:repositories',
    'page:findings',
    'page:health',
    'page:history',
    'page:reports',
    `page:reports-history:${repositoryId}`,
    `page:repository:${repositoryId}`,
  ]);
  invalidateCachedData(scope, (key) =>
    affectedPages.has(key)
    || key.startsWith('page:history:')
    || key.startsWith(`page:health:${repositoryId}`)
    || key === 'api:/repositories'
    || key === `api:${repositoryPath}`
    || key.startsWith(`api:${repositoryPath}/`)
    || key.startsWith('api:/findings/')
    || key.startsWith('page:finding:'));
}

export function invalidateRepositoryListData(scope: string): void {
  const affectedPages = new Set([
    'page:dashboard',
    'page:repositories',
    'page:health-repository-list',
    'page:findings',
    'page:health',
    'page:history',
    'page:history-repository-list',
    'page:reports',
  ]);
  invalidateCachedData(scope, (key) =>
    key === 'api:/repositories'
    || key.startsWith('api:/repositories/')
    || key.startsWith('api:/findings/')
    || key.startsWith('page:repository:')
    || key.startsWith('page:finding:')
    || key.startsWith('page:history:')
    || key.startsWith('page:reports-history:')
    || affectedPages.has(key));
}
