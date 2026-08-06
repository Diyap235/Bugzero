/**
 * Client-side auth store using localStorage for session persistence.
 * Simulates JWT flow — swap localStorage calls for real API token handling
 * when the backend is connected.
 */

import { UserProfile } from "@/types";

const TOKEN_KEY  = "bz_access_token";
const USER_KEY   = "bz_user";

export const authStore = {
  getToken(): string | null {
    if (typeof window === "undefined") return null;
    return localStorage.getItem(TOKEN_KEY);
  },

  getUser(): UserProfile | null {
    if (typeof window === "undefined") return null;
    const raw = localStorage.getItem(USER_KEY);
    if (!raw) return null;
    try { return JSON.parse(raw) as UserProfile; } catch { return null; }
  },

  setSession(token: string, user: UserProfile): void {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  },

  updateUser(user: UserProfile): void {
    const token = authStore.getToken();
    if (token) {
      localStorage.setItem(USER_KEY, JSON.stringify(user));
    }
  },

  clearSession(): void {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  },

  isAuthenticated(): boolean {
    return !!authStore.getToken();
  },
};
