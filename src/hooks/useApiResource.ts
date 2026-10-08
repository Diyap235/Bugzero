import { useCallback, useEffect, useState } from "react";

export interface ApiResource<T> {
  data: T | null;
  error: Error | null;
  loading: boolean;
  isFallback: boolean;
  refresh(): void;
}

export function useApiResource<T>(load: () => Promise<T>, fallback?: T): ApiResource<T> {
  const [data, setData] = useState<T | null>(() => fallback ?? null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  const [isFallback, setIsFallback] = useState(fallback !== undefined);
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((current) => current + 1), []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    load().then((value) => {
      if (!active) return;
      if (fallback !== undefined && Array.isArray(value) && value.length === 0) {
        setData(fallback);
        setIsFallback(true);
      } else {
        setData(value);
        setIsFallback(false);
      }
    }).catch((reason: unknown) => {
      if (!active) return;
      setError(reason instanceof Error ? reason : new Error("The workspace could not be loaded."));
      if (fallback !== undefined) {
        setData(fallback);
        setIsFallback(true);
      }
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [fallback, load, version]);

  return { data, error, loading, isFallback, refresh };
}
