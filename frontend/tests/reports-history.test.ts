import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("Reports fetches analysis history only for the selected repository", async () => {
  const source = await readFile(new URL("../src/app/reports/page.tsx", import.meta.url), "utf8");

  assert.match(source, /bugzeroApi\.getRepositoryHistory\(selectedRepositoryId\)/);
  assert.doesNotMatch(source, /repositories\.map\(\(repository\)\s*=>\s*bugzeroApi\.getRepositoryHistory/);
});
