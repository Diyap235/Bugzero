import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const appDirectory = join(root, "src", "app");

async function readSource(path: string): Promise<string> {
  return readFile(join(root, path), "utf8");
}

async function listTypeScriptFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory()
      ? listTypeScriptFiles(path)
      : entry.isFile() && /\.(tsx?|jsx?)$/.test(entry.name) ? [path] : [];
  }));
  return nested.flat();
}

test("all workspace navigation destinations use Next client-side links in the persistent shell", async () => {
  const [navigation, sidebar, appShell, workspaceShell, rootLayout] = await Promise.all([
    readSource("src/components/layout/navigation.ts"),
    readSource("src/components/layout/Sidebar.tsx"),
    readSource("src/components/layout/AppShell.tsx"),
    readSource("src/components/layout/WorkspaceShell.tsx"),
    readSource("src/app/layout.tsx"),
  ]);
  const destinations = [...navigation.matchAll(/name: "([^"]+)", href: "([^"]+)"/g)]
    .map(([, name, href]) => [name, href]);

  assert.deepEqual(destinations, [
    ["Overview", "/dashboard"],
    ["Repositories", "/repositories"],
    ["Findings", "/findings"],
    ["Health", "/health"],
    ["History", "/history"],
    ["Reports", "/reports"],
    ["Settings", "/settings"],
  ]);
  assert.match(sidebar, /import Link from "next\/link"/);
  assert.match(sidebar, /WORKSPACE_NAV_ITEMS\.map/);
  assert.match(sidebar, /<Link[\s\S]*?href=\{item\.href\}/);
  assert.match(appShell, /import Link from "next\/link"/);
  assert.match(appShell, /WORKSPACE_NAV_ITEMS\.map/);
  assert.match(appShell, /<Link[\s\S]*?href=\{href\}/);
  assert.match(rootLayout, /<WorkspaceShell>\{children\}<\/WorkspaceShell>/);
  assert.match(workspaceShell, /<AppShell>\{children\}<\/AppShell>/);
  assert.match(workspaceShell, /WORKSPACE_ROUTE_SEGMENTS\.has\(firstSegment\)/);
  assert.doesNotMatch(appShell, /key=\{pathname\}/);
});

test("application routes do not use native document navigation for internal route links", async () => {
  const files = await listTypeScriptFiles(appDirectory);
  const sources = await Promise.all(files.map((file) => readFile(file, "utf8")));

  for (const [index, source] of sources.entries()) {
    assert.doesNotMatch(source, /window\.location|location\.(?:assign|replace)\s*\(/, files[index]);
    assert.doesNotMatch(source, /<a\b[^>]*href\s*=\s*["']\//, files[index]);
  }
});
