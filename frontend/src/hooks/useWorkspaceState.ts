"use client";

import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { getSession } from "@/lib/auth/auth-service";
import {
  getCachedData,
  setCachedData,
  subscribeToCacheInvalidation,
} from "@/lib/data-cache";

interface ScopedValue<T> {
  scope: string | null;
  key: string;
  value: T;
}

export function useWorkspaceState<T>(
  key: string,
  initialValue: T,
): [T, Dispatch<SetStateAction<T>>] {
  const scope = getSession()?.accessToken ?? null;
  const cacheKey = `view:${key}`;
  const cachedValue = scope ? getCachedData<T>(scope, cacheKey) : undefined;
  const [scopedValue, setScopedValue] = useState<ScopedValue<T>>(() => ({
    scope,
    key: cacheKey,
    value: cachedValue ?? initialValue,
  }));
  const value = scopedValue.scope === scope && scopedValue.key === cacheKey
    ? scopedValue.value
    : cachedValue ?? initialValue;

  const setValue = useCallback<Dispatch<SetStateAction<T>>>((nextValue) => {
    setScopedValue((current) => {
      const currentValue = current.scope === scope && current.key === cacheKey
        ? current.value
        : scope ? getCachedData<T>(scope, cacheKey) ?? initialValue : initialValue;
      const resolvedValue = typeof nextValue === "function"
        ? (nextValue as (previous: T) => T)(currentValue)
        : nextValue;
      if (scope) setCachedData(scope, cacheKey, resolvedValue);
      return { scope, key: cacheKey, value: resolvedValue };
    });
  }, [cacheKey, initialValue, scope]);

  useEffect(() => subscribeToCacheInvalidation(() => {
    setScopedValue({ scope, key: cacheKey, value: initialValue });
  }), [cacheKey, initialValue, scope]);

  useEffect(() => {
    setScopedValue({ scope, key: cacheKey, value: cachedValue ?? initialValue });
  }, [cacheKey, cachedValue, initialValue, scope]);

  return [value, setValue];
}
