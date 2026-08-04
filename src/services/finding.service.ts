import { MOCK_FINDINGS } from "@/lib/mock-data";
import { Finding, FindingStatus } from "@/types";

let findings = [...MOCK_FINDINGS];

export const findingService = {
  getFindingsByReviewId: async (
    reviewId: string,
    search?: string,
    severity?: string,
    status?: string
  ): Promise<Finding[]> => {
    await new Promise((res) => setTimeout(res, 250));
    let result = [...findings];
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (f) =>
          f.title.toLowerCase().includes(q) ||
          f.file.toLowerCase().includes(q) ||
          f.summary.toLowerCase().includes(q)
      );
    }
    if (severity && severity !== "All") {
      result = result.filter((f) => f.severity.toLowerCase() === severity.toLowerCase());
    }
    if (status && status !== "All") {
      result = result.filter((f) => f.status.toLowerCase() === status.toLowerCase());
    }
    return result;
  },

  getFindingById: async (id: string): Promise<Finding | null> => {
    await new Promise((res) => setTimeout(res, 150));
    const finding = findings.find((f) => f.id === id);
    return finding || null;
  },

  updateFindingStatus: async (id: string, status: FindingStatus): Promise<Finding> => {
    await new Promise((res) => setTimeout(res, 300));
    const index = findings.findIndex((f) => f.id === id);
    if (index === -1) throw new Error("Finding not found");
    findings[index] = {
      ...findings[index],
      status,
      severity: status === "resolved" ? "resolved" : findings[index].severity,
    };
    return findings[index];
  },
};
