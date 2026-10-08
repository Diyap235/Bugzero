import type { AuthSession, AuthSessionState, AuthUser } from "./auth-types";

const SESSION_STORAGE_KEY = "bugzero_session";

function isAuthSession(value: unknown): value is AuthSession {
  if (typeof value !== "object" || value === null) return false;
  const session = value as Partial<AuthSession>;
  if (
    typeof session.accessToken !== "string"
    || session.accessToken.split(".").length !== 3
    || session.accessToken.startsWith("demo-session.")
  ) return false;
  if (typeof session.issuedAt !== "number" || typeof session.expiresAt !== "number") return false;
  if (typeof session.user !== "object" || session.user === null) return false;

  const user = session.user as Partial<AuthUser>;
  return typeof user.userId === "string"
    && typeof user.email === "string"
    && typeof user.role === "string";
}

export function setSession(session: AuthSession): void {
  if (typeof window === "undefined") {
    throw new Error("Authentication sessions can only be stored in a browser.");
  }
  window.sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
}

export function clearSession(): void {
  if (typeof window !== "undefined") {
    window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
  }
}

export function getRawStoredSession(): AuthSession | null {
  if (typeof window === "undefined") return null;
  const serialized = window.sessionStorage.getItem(SESSION_STORAGE_KEY);
  if (!serialized) return null;
  try {
    const stored = JSON.parse(serialized);
    return isAuthSession(stored) ? stored : null;
  } catch {
    return null;
  }
}

export function getSessionState(): AuthSessionState {
  if (typeof window === "undefined") return { session: null, expired: false };

  const serialized = window.sessionStorage.getItem(SESSION_STORAGE_KEY);
  if (serialized === null) return { session: null, expired: false };

  let stored: unknown;
  try {
    stored = JSON.parse(serialized);
  } catch {
    clearSession();
    return { session: null, expired: false };
  }

  if (!isAuthSession(stored)) {
    clearSession();
    return { session: null, expired: false };
  }
  if (stored.expiresAt <= Date.now()) {
    clearSession();
    return { session: null, expired: true };
  }
  return { session: stored, expired: false };
}

export function getSession(): AuthSession | null {
  const state = getSessionState();
  if (state.session && !state.expired) return state.session;
  return null;
}

export function isAuthenticated(): boolean {
  return getSession() !== null;
}

export function getCurrentUser(): AuthUser | null {
  return getSession()?.user ?? null;
}
