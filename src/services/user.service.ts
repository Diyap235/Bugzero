import { MOCK_USER } from "@/lib/mock-data";
import { UserProfile, UserPreferences, AIProviderConfig } from "@/types";

let user = { ...MOCK_USER };

export const userService = {
  getCurrentUser: async (): Promise<UserProfile> => {
    await new Promise((res) => setTimeout(res, 200));
    return user;
  },

  updateProfile: async (name: string, organization?: string): Promise<UserProfile> => {
    await new Promise((res) => setTimeout(res, 400));
    user = { ...user, name, organization };
    return user;
  },

  updatePreferences: async (preferences: Partial<UserPreferences>): Promise<UserProfile> => {
    await new Promise((res) => setTimeout(res, 300));
    user = {
      ...user,
      preferences: { ...user.preferences, ...preferences },
    };
    return user;
  },

  updateAIProvider: async (aiProvider: Partial<AIProviderConfig>): Promise<UserProfile> => {
    await new Promise((res) => setTimeout(res, 350));
    user = {
      ...user,
      aiProvider: { ...user.aiProvider, ...aiProvider },
    };
    return user;
  },
};
