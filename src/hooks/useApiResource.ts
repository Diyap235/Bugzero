import { useCallback, useEffect, useState } from "react";

export interface ApiResource<T> {
  data: T | null;
  error: Error | null;
  loading: boolean;
  refresh(): void;
}

export function useApiResource<T>(load: () => Promise<T>): ApiResource<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((current) => current + 1), []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    load().then((value) => {
      if (!active) return;
      setData(value);
    }).catch((reason: unknown) => {
      if (!active) return;
      setError(reason instanceof Error ? reason : new Error("The workspace could not be loaded."));
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [load, version]);

  return { data, error, loading, refresh };
}
