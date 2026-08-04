export type Severity = "critical" | "high" | "medium" | "low" | "resolved";

export type FindingStatus = "open" | "resolved" | "ignored";

export interface Finding {
  id: string;
  reviewId: string;
  repositoryId: string;
  title: string;
  summary: string;
  severity: Severity;
  confidence: number; // 0 to 100
  status: FindingStatus;
  file: string;
  line: number;
  evidence: {
    codeSnippet: string;
    staticAnalysisSource: "Pylint" | "Bandit" | "CodeBERT";
    lineNumbers: string;
  };
  aiExplanation: {
    problem: string;
    whyItMatters: string;
    riskLevel: string;
    bestPractice: string;
  };
  impact: string;
  suggestedFix: {
    explanation: string;
    patchPreview: string;
  };
  diff: {
    original: string;
    modified: string;
  };
  references: string[];
}

export interface Repository {
  id: string;
  name: string;
  description: string;
  primaryLanguage: string;
  healthScore: number; // 0 - 100
  openFindingsCount: number;
  criticalFindingsCount: number;
  lastReviewDate: string;
  branch: string;
  fileCount: number;
  updatedAt: string;
}

export interface Review {
  id: string;
  repositoryId: string;
  status: "pending" | "analyzing" | "completed" | "failed";
  progressStep?: string;
  healthScore: number;
  findingsCount: number;
  createdAt: string;
  duration: string;
  reviewer: string;
}

export interface HealthData {
  repositoryId: string;
  overallHealth: number;
  qualityScore: number;
  securityScore: number;
  openFindings: number;
  lastReviewDate: string;
  qualityTrend: { date: string; score: number }[];
  securityTrend: {
    critical: number;
    high: number;
    medium: number;
    low: number;
  };
  technicalDebt: {
    maintainability: string;
    complexity: string;
    duplicatedCode: string;
    documentationCoverage: string;
  };
  weakModules: {
    module: string;
    health: number;
    findings: number;
    risk: "High" | "Medium" | "Low";
    lastReviewed: string;
  }[];
  reviewMetrics: {
    averageReviewTime: string;
    totalReviews: number;
    findingsResolved: number;
    repositoryImprovement: string;
  };
}

export interface Report {
  id: string;
  reportName: string;
  repositoryId: string;
  repositoryName: string;
  reviewDate: string;
  healthScore: number;
  format: "PDF" | "JSON";
  sizeBytes: number;
  downloadUrl: string;
}

export interface UserPreferences {
  defaultExplanationLevel: "Basic" | "Detailed" | "Deep";
  autoOpenDrawer: boolean;
  defaultReportFormat: "PDF" | "JSON";
  enableKeyboardShortcuts: boolean;
}

export interface AIProviderConfig {
  provider: "OpenAI" | "Claude";
  model: string;
  explanationLevel: "Basic" | "Detailed" | "Deep";
}

export interface UserProfile {
  id: string;
  name: string;
  email: string;
  avatarUrl: string;
  organization?: string;
  preferences: UserPreferences;
  aiProvider: AIProviderConfig;
}
