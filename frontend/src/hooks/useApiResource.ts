import { useCallback, useEffect, useState } from "react";
import { getSession } from "@/lib/auth/auth-service";
import {
  getCachedData,
  getStaleCachedData,
  invalidatePageData,
  loadCachedData,
  subscribeToCacheInvalidation,
} from "@/lib/data-cache";

export interface ApiResource<T> {
  data: T | null;
  error: Error | null;
  refreshError: Error | null;
  loading: boolean;
  refresh(options?: { invalidate?: boolean }): void;
}

interface ApiResourceOptions {
  key: string;
  cache?: boolean;
  staleTimeMs?: number;
  revalidateIntervalMs?: number;
}

interface ScopedValue<T> {
  scope: string | null;
  key: string;
  value: T;
}

interface ScopedLoading {
  scope: string | null;
  key: string;
  value: boolean;
}

export function useApiResource<T>(load: () => Promise<T>, options: ApiResourceOptions): ApiResource<T> {
  const scope = getSession()?.accessToken ?? null;
  const pageKey = `page:${options.key}`;
  const cacheEnabled = options.cache !== false && scope !== null;
  const initialData = cacheEnabled && scope ? getStaleCachedData<T>(scope, pageKey) : undefined;
  const [scopedData, setScopedData] = useState<ScopedValue<T> | null>(() =>
    initialData === undefined ? null : { scope, key: pageKey, value: initialData });
  const [scopedError, setScopedError] = useState<ScopedValue<Error> | null>(null);
  const [scopedLoading, setScopedLoading] = useState<ScopedLoading>(() => ({
    scope,
    key: pageKey,
    value: initialData === undefined,
  }));
  const [version, setVersion] = useState(0);
  const data = scopedData?.scope === scope && scopedData.key === pageKey ? scopedData.value : null;
  const requestError = scopedError?.scope === scope && scopedError.key === pageKey
    ? scopedError.value
    : null;
  const error = data === null ? requestError : null;
  const refreshError = data === null ? null : requestError;
  const loading = data === null
    && (scopedLoading.scope !== scope || scopedLoading.key !== pageKey || scopedLoading.value);
  const fetching = scopedLoading.scope === scope
    && scopedLoading.key === pageKey
    && scopedLoading.value;
  const refresh = useCallback((refreshOptions: { invalidate?: boolean } = {}) => {
    if (scope && refreshOptions.invalidate !== false) invalidatePageData(scope, options.key);
    setScopedLoading({ scope, key: pageKey, value: true });
    setVersion((current) => current + 1);
  }, [options.key, pageKey, scope]);

  useEffect(() => subscribeToCacheInvalidation(() => {
    setScopedData(null);
    setScopedError(null);
    setScopedLoading({ scope, key: pageKey, value: true });
  }), [pageKey, scope]);

  useEffect(() => {
    if (!cacheEnabled || !scope || fetching) return;
    const revalidateIfStale = () => {
      if (document.visibilityState === "hidden" || getCachedData(scope, pageKey) !== undefined) return;
      setVersion((current) => current + 1);
    };
    const interval = options.revalidateIntervalMs === undefined
      ? undefined
      : window.setTimeout(revalidateIfStale, options.revalidateIntervalMs);
    window.addEventListener("focus", revalidateIfStale);
    document.addEventListener("visibilitychange", revalidateIfStale);
    return () => {
      if (interval !== undefined) window.clearTimeout(interval);
      window.removeEventListener("focus", revalidateIfStale);
      document.removeEventListener("visibilitychange", revalidateIfStale);
    };
  }, [cacheEnabled, fetching, options.revalidateIntervalMs, pageKey, scope, version]);

  useEffect(() => {
    let active = true;
    const cached = cacheEnabled && scope ? getCachedData<T>(scope, pageKey) : undefined;
    if (cached !== undefined) {
      setScopedData({ scope, key: pageKey, value: cached });
      setScopedError(null);
      setScopedLoading({ scope, key: pageKey, value: false });
      return () => { active = false; };
    }
    const stale = cacheEnabled && scope ? getStaleCachedData<T>(scope, pageKey) : undefined;
    if (stale !== undefined) setScopedData({ scope, key: pageKey, value: stale });
    setScopedLoading({ scope, key: pageKey, value: true });
    setScopedError(null);
    const pending = cacheEnabled && scope
      ? loadCachedData(scope, pageKey, load, options.staleTimeMs)
      : load();
    pending.then((value) => {
      if (!active) return;
      setScopedData({ scope, key: pageKey, value });
    }).catch((reason: unknown) => {
      if (!active) return;
      setScopedError({
        scope,
        key: pageKey,
        value: reason instanceof Error ? reason : new Error("The workspace could not be loaded."),
      });
    }).finally(() => {
      if (active) setScopedLoading({ scope, key: pageKey, value: false });
    });
    return () => { active = false; };
  }, [cacheEnabled, load, options.staleTimeMs, pageKey, scope, version]);

  return { data, error, refreshError, loading, refresh };
}
