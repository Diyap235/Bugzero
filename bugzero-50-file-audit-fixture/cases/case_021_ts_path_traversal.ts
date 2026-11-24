import { readFileSync } from "node:fs";
export function readUserFile(name: string) {
  return readFileSync("/tmp/docs/" + name, "utf8");
}
