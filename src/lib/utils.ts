import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { Severity } from "@/types";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatBytes(bytes: number, decimals = 1) {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + " " + sizes[i];
}

export function getSeverityBadgeStyles(severity: Severity) {
  switch (severity) {
    case "critical":
      return "bg-danger/15 text-danger border-danger/30";
    case "high":
      return "bg-warning/15 text-warning border-warning/30";
    case "medium":
      return "bg-yellow-500/15 text-yellow-500 border-yellow-500/30";
    case "low":
      return "bg-info/15 text-info border-info/30";
    case "resolved":
      return "bg-success/15 text-success border-success/30";
    default:
      return "bg-text-secondary/15 text-text-secondary border-text-secondary/30";
  }
}

export function getConfidenceBadgeStyles(confidence: number) {
  if (confidence >= 80) return "bg-success/15 text-success border-success/30";
  if (confidence >= 50) return "bg-warning/15 text-warning border-warning/30";
  return "bg-text-muted/15 text-text-muted border-text-muted/30";
}
