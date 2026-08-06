/**
 * user.service — reads current user from auth-store (localStorage).
 * All mutations go through authService so session stays in sync.
 */
import { authStore } from "@/lib/auth-store";
import { UserProfile, DEFAULT_PREFERENCES } from "@/types";

const FALLBACK: UserProfile = {
  id: "user-1",
  name: "Alex Vance",
  email: "alex.vance@engineering.io",
  avatarUrl: "",
  preferences: { ...DEFAULT_PREFERENCES },
};

export const userService = {
  getCurrentUser: async (): Promise<UserProfile> => {
    await new Promise((res) => setTimeout(res, 100));
    const persisted = authStore.getUser();
    return persisted ?? FALLBACK;
  },
};
