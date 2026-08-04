import React from "react";
import { Clock, CheckCircle2, ShieldAlert, FileText } from "lucide-react";
import { Card, CardHeader, CardTitle } from "../shared/Card";

export const Timeline: React.FC = () => {
  const events = [
    {
      icon: <CheckCircle2 className="w-4 h-4 text-success" />,
      title: "Review Completed",
      desc: "BugZero AI v2.1 finished full analysis in 1.4s",
      time: "2 hours ago",
    },
    {
      icon: <ShieldAlert className="w-4 h-4 text-warning" />,
      title: "Finding Identified",
      desc: "Critical SQL Injection risk detected in user_repo.py:48",
      time: "2 hours ago",
    },
    {
      icon: <FileText className="w-4 h-4 text-info" />,
      title: "Report Exported",
      desc: "PDF Audit report generated for auth-service-python",
      time: "1 day ago",
    },
  ];

  return (
    <Card className="space-y-4">
      <CardHeader className="mb-0">
        <CardTitle className="text-base">Recent Activity Timeline</CardTitle>
      </CardHeader>

      <div className="relative pl-6 space-y-4 before:absolute before:left-2.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-border">
        {events.map((evt, idx) => (
          <div key={idx} className="relative flex items-start gap-3 text-xs">
            <div className="absolute -left-6 top-0.5 bg-card p-1 border border-border rounded-full">
              {evt.icon}
            </div>
            <div className="flex-1">
              <span className="font-semibold text-text-primary block">{evt.title}</span>
              <span className="text-text-secondary">{evt.desc}</span>
            </div>
            <span className="text-text-muted font-mono">{evt.time}</span>
          </div>
        ))}
      </div>
    </Card>
  );
};
