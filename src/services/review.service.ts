import { MOCK_REVIEWS } from "@/lib/mock-data";
import { Review } from "@/types";

let reviews = [...MOCK_REVIEWS];

export const reviewService = {
  getReviewsByRepoId: async (repoId: string): Promise<Review[]> => {
    await new Promise((res) => setTimeout(res, 300));
    return reviews.filter((r) => r.repositoryId === repoId);
  },

  getReviewById: async (id: string): Promise<Review | null> => {
    await new Promise((res) => setTimeout(res, 200));
    return reviews.find((r) => r.id === id) || null;
  },

  startReview: async (repoId: string): Promise<Review> => {
    await new Promise((res) => setTimeout(res, 600));
    const newReview: Review = {
      id: `rev-${Date.now()}`,
      repositoryId: repoId,
      status: "completed",
      healthScore: 89,
      findingsCount: 3,
      createdAt: new Date().toISOString().replace("T", " ").substring(0, 16),
      duration: "1.2s",
      reviewer: "BugZero AI v2.1",
    };
    reviews.unshift(newReview);
    return newReview;
  },
};
