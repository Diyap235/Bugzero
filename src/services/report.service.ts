import { MOCK_REPORTS } from "@/lib/mock-data";
import { Report } from "@/types";

let reports = [...MOCK_REPORTS];

export const reportService = {
  getReports: async (search?: string, format?: string): Promise<Report[]> => {
    await new Promise((res) => setTimeout(res, 300));
    let result = [...reports];
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (r) =>
          r.reportName.toLowerCase().includes(q) ||
          r.repositoryName.toLowerCase().includes(q)
      );
    }
    if (format && format !== "All") {
      result = result.filter((r) => r.format.toLowerCase() === format.toLowerCase());
    }
    return result;
  },

  deleteReport: async (id: string): Promise<void> => {
    await new Promise((res) => setTimeout(res, 300));
    reports = reports.filter((r) => r.id !== id);
  },
};
