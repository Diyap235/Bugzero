import type { AuthSession, AuthSessionState, AuthUser } from "./auth-types";

// sessionStorage is intentionally used for this demo; production sessions must be server-issued.
const SESSION_STORAGE_KEY = "bugzero_demo_session";

function isAuthSession(value: unknown): value is AuthSession {
  if (typeof value !== "object" || value === null) return false;
  const session = value as Partial<AuthSession>;
  if (typeof session.accessToken !== "string" || !session.accessToken.startsWith("demo-session.")) return false;
  if (typeof session.issuedAt !== "number" || typeof session.expiresAt !== "number") return false;
  if (typeof session.user !== "object" || session.user === null) return false;

  const user = session.user as Partial<AuthUser>;
  return typeof user.userId === "string"
    && typeof user.email === "string"
    && user.role === "DEMO_USER";
}

export function setSession(session: AuthSession): void {
  if (typeof window === "undefined") {
    throw new Error("Demo sessions can only be stored in a browser.");
  }
  window.sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
}

export function clearSession(): void {
  if (typeof window !== "undefined") {
    window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
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
  return getSessionState().session;
}

export function isAuthenticated(): boolean {
  return getSession() !== null;
}

export function getCurrentUser(): AuthUser | null {
  return getSession()?.user ?? null;
}
