import { exec } from "node:child_process";
export function runReport(name: string) {
  exec("report-tool " + name);
}
