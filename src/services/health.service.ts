import { MOCK_HEALTH_DATA } from "@/lib/mock-data";
import { HealthData } from "@/types";

export const healthService = {
  getHealthByRepoId: async (repoId: string): Promise<HealthData> => {
    await new Promise((res) => setTimeout(res, 250));
    return {
      ...MOCK_HEALTH_DATA,
      repositoryId: repoId,
    };
  },
};
