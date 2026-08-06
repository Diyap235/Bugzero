import { UserProfile, DEFAULT_PREFERENCES } from "@/types";
import { authStore } from "@/lib/auth-store";

interface StoredUser {
  email: string;
  passwordHash: string;
  profile: UserProfile;
}

// In-memory user store — survives page refresh via authStore (localStorage)
const SEED_USER: UserProfile = {
  id: "user-1",
  name: "Alex Vance",
  email: "alex.vance@engineering.io",
  avatarUrl: "",
  preferences: { ...DEFAULT_PREFERENCES },
};

const storedUsers: StoredUser[] = [
  { email: "alex.vance@engineering.io", passwordHash: "password123", profile: { ...SEED_USER } },
];

function makeToken(): string {
  return `bz_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export const authService = {
  login: async (email: string, password: string): Promise<{ user: UserProfile; accessToken: string }> => {
    await new Promise((res) => setTimeout(res, 600));
    const found = storedUsers.find(
      (u) => u.email.toLowerCase() === email.toLowerCase() && u.passwordHash === password
    );
    if (!found) throw new Error("Incorrect email or password.");
    const token = makeToken();
    authStore.setSession(token, found.profile);
    return { user: found.profile, accessToken: token };
  },

  register: async (name: string, email: string, password: string): Promise<{ user: UserProfile; accessToken: string }> => {
    await new Promise((res) => setTimeout(res, 800));
    if (storedUsers.some((u) => u.email.toLowerCase() === email.toLowerCase())) {
      throw new Error("An account with this email already exists.");
    }
    const profile: UserProfile = {
      id: `user-${Date.now()}`,
      name,
      email,
      avatarUrl: "",
      preferences: { ...DEFAULT_PREFERENCES },
    };
    storedUsers.push({ email, passwordHash: password, profile });
    const token = makeToken();
    authStore.setSession(token, profile);
    return { user: profile, accessToken: token };
  },

  logout: async (): Promise<void> => {
    await new Promise((res) => setTimeout(res, 150));
    authStore.clearSession();
  },

  /** Update name and/or avatar. Password change handled separately. */
  updateProfile: async (updates: { name?: string; avatarUrl?: string }): Promise<UserProfile> => {
    await new Promise((res) => setTimeout(res, 400));
    const current = authStore.getUser();
    if (!current) throw new Error("Not authenticated.");
    const updated: UserProfile = {
      ...current,
      name: updates.name ?? current.name,
      avatarUrl: updates.avatarUrl ?? current.avatarUrl,
    };
    const idx = storedUsers.findIndex((u) => u.email === current.email);
    if (idx !== -1) storedUsers[idx].profile = updated;
    authStore.updateUser(updated);
    return updated;
  },

  changePassword: async (currentPassword: string, newPassword: string): Promise<void> => {
    await new Promise((res) => setTimeout(res, 500));
    const current = authStore.getUser();
    if (!current) throw new Error("Not authenticated.");
    const idx = storedUsers.findIndex((u) => u.email === current.email);
    if (idx === -1 || storedUsers[idx].passwordHash !== currentPassword) {
      throw new Error("Current password is incorrect.");
    }
    storedUsers[idx].passwordHash = newPassword;
  },

  updatePreferences: async (preferences: UserProfile["preferences"]): Promise<UserProfile> => {
    await new Promise((res) => setTimeout(res, 300));
    const current = authStore.getUser();
    if (!current) throw new Error("Not authenticated.");
    const updated: UserProfile = { ...current, preferences };
    const idx = storedUsers.findIndex((u) => u.email === current.email);
    if (idx !== -1) storedUsers[idx].profile = updated;
    authStore.updateUser(updated);
    return updated;
  },
};
