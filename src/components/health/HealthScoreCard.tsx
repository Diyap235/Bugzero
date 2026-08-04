import React from "react";
import { Card } from "../shared/Card";
import { TrendingUp, ShieldCheck, Award } from "lucide-react";

interface HealthScoreCardProps {
  overallHealth: number;
  qualityScore: number;
  securityScore: number;
}

export const HealthScoreCard: React.FC<HealthScoreCardProps> = ({
  overallHealth,
  qualityScore,
  securityScore,
}) => {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
      {/* Overall Health Card */}
      <Card className="bg-card border-primary/40 space-y-3">
        <div className="flex items-center justify-between text-xs text-text-muted">
          <span className="font-semibold uppercase tracking-wider">Overall Health Score</span>
          <Award className="w-4 h-4 text-primary" />
        </div>
        <div className="flex items-baseline gap-3">
          <span className="text-4xl font-bold font-mono text-success">{overallHealth}</span>
          <span className="text-xs text-text-muted">/ 100</span>
          <span className="text-xs text-success font-semibold flex items-center gap-0.5 ml-auto">
            <TrendingUp className="w-3.5 h-3.5" /> +12% this month
          </span>
        </div>
        <div className="w-full bg-surface h-2 rounded-full overflow-hidden border border-border">
          <div className="bg-success h-full transition-all duration-500" style={{ width: `${overallHealth}%` }} />
        </div>
      </Card>

      {/* Code Quality Card */}
      <Card className="space-y-3">
        <div className="flex items-center justify-between text-xs text-text-muted">
          <span className="font-semibold uppercase tracking-wider">Pylint Code Quality</span>
          <ShieldCheck className="w-4 h-4 text-info" />
        </div>
        <div className="flex items-baseline gap-3">
          <span className="text-4xl font-bold font-mono text-info">{qualityScore}</span>
          <span className="text-xs text-text-muted">/ 100</span>
        </div>
        <div className="w-full bg-surface h-2 rounded-full overflow-hidden border border-border">
          <div className="bg-info h-full transition-all duration-500" style={{ width: `${qualityScore}%` }} />
        </div>
      </Card>

      {/* Security Health Card */}
      <Card className="space-y-3">
        <div className="flex items-center justify-between text-xs text-text-muted">
          <span className="font-semibold uppercase tracking-wider">Bandit Security Score</span>
          <ShieldCheck className="w-4 h-4 text-warning" />
        </div>
        <div className="flex items-baseline gap-3">
          <span className="text-4xl font-bold font-mono text-warning">{securityScore}</span>
          <span className="text-xs text-text-muted">/ 100</span>
        </div>
        <div className="w-full bg-surface h-2 rounded-full overflow-hidden border border-border">
          <div className="bg-warning h-full transition-all duration-500" style={{ width: `${securityScore}%` }} />
        </div>
      </Card>
    </div>
  );
};
