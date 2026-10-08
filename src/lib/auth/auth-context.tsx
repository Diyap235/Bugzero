"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { AuthContextValue, AuthCredentials, AuthService, AuthSession, RegistrationDetails } from "./auth-types";
import { backendAuthService } from "./backend-auth";
import { ApiError } from "@/lib/api-client";

const AuthContext = createContext<AuthContextValue | null>(null);

function AuthContextProvider({ children, service }: { children: ReactNode; service: AuthService }) {
  const [session, setCurrentSession] = useState<AuthSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [sessionExpired, setSessionExpired] = useState(false);

  const handleUnauthorized = useCallback(() => {
    service.logout();
    setCurrentSession(null);
    setSessionExpired(true);
  }, [service]);

  useEffect(() => {
    const stored = service.getSessionState();
    if (!stored.session) {
      setCurrentSession(null);
      setSessionExpired(stored.expired);
      setIsLoading(false);
      return;
    }

    let active = true;

    void service.validateSession().then(() => {
      if (active) setCurrentSession(stored.session);
    }).catch((error: unknown) => {
      if (!active) return;
      if (error instanceof ApiError && (error.code === "UNAUTHORIZED" || error.code === "FORBIDDEN")) {
        service.logout();
        setCurrentSession(null);
        setSessionExpired(true);
      } else {
        setCurrentSession(stored.session);
      }
    }).finally(() => {
      if (active) setIsLoading(false);
    });
    return () => {
      active = false;
    };
  }, [service]);

  useEffect(() => {
    window.addEventListener("bugzero:unauthorized", handleUnauthorized);
    return () => window.removeEventListener("bugzero:unauthorized", handleUnauthorized);
  }, [handleUnauthorized]);

  useEffect(() => {
    if (!session) return;

    const timer = window.setTimeout(() => {
      service.logout();
      setCurrentSession(null);
      setSessionExpired(true);
    }, Math.max(0, session.expiresAt - Date.now()));

    const checkSession = () => {
      const current = service.getSessionState();
      if (!current.session) {
        setCurrentSession(null);
        setSessionExpired(current.expired);
      }
    };

    window.addEventListener("focus", checkSession);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("focus", checkSession);
    };
  }, [service, session]);

  const login = useCallback(async (credentials: AuthCredentials) => {
    const nextSession = await service.login(credentials);
    setCurrentSession(nextSession);
    setSessionExpired(false);
  }, [service]);

  const register = useCallback(async (details: RegistrationDetails) => {
    const nextSession = await service.register(details);
    setCurrentSession(nextSession);
    setSessionExpired(false);
  }, [service]);

  const logout = useCallback(() => {
    service.logout();
    setCurrentSession(null);
    setSessionExpired(false);
  }, [service]);

  const value = useMemo<AuthContextValue>(() => ({
    user: session?.user ?? null,
    isAuthenticated: session !== null,
    isLoading,
    sessionExpired,
    login,
    register,
    logout,
  }), [isLoading, login, logout, register, session, sessionExpired]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  return <AuthContextProvider service={backendAuthService}>{children}</AuthContextProvider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider.");
  return context;
}
