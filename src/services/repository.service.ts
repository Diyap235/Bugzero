import { MOCK_REPOSITORIES } from "@/lib/mock-data";
import { Repository } from "@/types";

let repositories = [...MOCK_REPOSITORIES];

export const repositoryService = {
  getRepositories: async (search?: string, language?: string): Promise<Repository[]> => {
    await new Promise((res) => setTimeout(res, 300));
    let result = [...repositories];
    if (search) {
      const query = search.toLowerCase();
      result = result.filter(
        (r) => r.name.toLowerCase().includes(query) || r.description.toLowerCase().includes(query)
      );
    }
    if (language && language !== "All") {
      result = result.filter((r) => r.primaryLanguage.toLowerCase() === language.toLowerCase());
    }
    return result;
  },

  getRepositoryById: async (id: string): Promise<Repository | null> => {
    await new Promise((res) => setTimeout(res, 200));
    const repo = repositories.find((r) => r.id === id);
    return repo || null;
  },

  createRepository: async (name: string, description: string, language = "Python"): Promise<Repository> => {
    await new Promise((res) => setTimeout(res, 500));
    const newRepo: Repository = {
      id: `repo-${Date.now()}`,
      name,
      description,
      primaryLanguage: language,
      healthScore: 100,
      openFindingsCount: 0,
      criticalFindingsCount: 0,
      lastReviewDate: new Date().toISOString().split("T")[0],
      branch: "main",
      fileCount: 12,
      updatedAt: "Just now",
    };
    repositories.unshift(newRepo);
    return newRepo;
  },

  deleteRepository: async (id: string): Promise<void> => {
    await new Promise((res) => setTimeout(res, 400));
    repositories = repositories.filter((r) => r.id !== id);
  },
};
