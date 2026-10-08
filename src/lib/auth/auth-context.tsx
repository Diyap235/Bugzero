"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { AuthContextValue, AuthCredentials, AuthService, AuthSession } from "./auth-types";
import { demoAuthService } from "./demo-auth";

const AuthContext = createContext<AuthContextValue | null>(null);

function AuthContextProvider({ children, service }: { children: ReactNode; service: AuthService }) {
  const [session, setCurrentSession] = useState<AuthSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [sessionExpired, setSessionExpired] = useState(false);

  useEffect(() => {
    const stored = service.getSessionState();
    setCurrentSession(stored.session);
    setSessionExpired(stored.expired);
    setIsLoading(false);
  }, [service]);

  const expireSession = useCallback(() => {
    service.logout();
    setCurrentSession(null);
    setSessionExpired(true);
  }, [service]);

  useEffect(() => {
    if (!session) return;

    const checkSession = () => {
      const current = service.getSessionState();
      if (!current.session) {
        setCurrentSession(null);
        setSessionExpired(current.expired);
      }
    };
    const delay = session.expiresAt - Date.now();
    if (delay <= 0) {
      expireSession();
      return;
    }
    const timer = window.setTimeout(expireSession, delay);
    window.addEventListener("focus", checkSession);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("focus", checkSession);
    };
  }, [expireSession, service, session]);

  const login = useCallback(async (credentials: AuthCredentials) => {
    const nextSession = await service.login(credentials);
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
    logout,
  }), [isLoading, login, logout, session, sessionExpired]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function DemoAuthProvider({ children }: { children: ReactNode }) {
  return <AuthContextProvider service={demoAuthService}>{children}</AuthContextProvider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within DemoAuthProvider.");
  return context;
}
