import { MOCK_USER } from "@/lib/mock-data";
import { UserProfile } from "@/types";

export const authService = {
  login: async (email: string, password: string): Promise<{ user: UserProfile; accessToken: string }> => {
    // Simulate network delay
    await new Promise((res) => setTimeout(res, 600));
    if (email && password) {
      return {
        user: { ...MOCK_USER, email },
        accessToken: "mock-jwt-access-token-12345",
      };
    }
    throw new Error("Invalid credentials");
  },

  register: async (name: string, email: string, password: string): Promise<{ user: UserProfile; accessToken: string }> => {
    await new Promise((res) => setTimeout(res, 800));
    return {
      user: { ...MOCK_USER, name, email },
      accessToken: "mock-jwt-access-token-67890",
    };
  },

  logout: async (): Promise<void> => {
    await new Promise((res) => setTimeout(res, 200));
  },
};
